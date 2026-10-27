import fs from "node:fs";
import path from "node:path";

import { ErrorCode } from "./codes";
import {
  dropHiddenPlayers,
  getDb,
  getSetting,
  ingestLoot,
  ingestPartyEvents,
  ingestSales,
  invalidateSocialFiles,
  rememberCharacter,
  setSetting,
  showEveryone,
  type IngestResult,
} from "./db";
import { itemKey } from "./format";
import {
  contextFromPath,
  ledgerFileKind,
  ownerFromLedgerPath,
  parseLedgerDocument,
  type ParsedLoot,
} from "./ledger-parse";
import { readLedgerText } from "./read-text";

export type ScanSnapshot = {
  watchPath: string | null;
  /** Usual MnM client folder on this machine (not saved until the user confirms). */
  suggestedPath: string | null;
  lastScanAt: string | null;
  scanning: boolean;
  filesSeen: number;
  filesRead: number;
  filesUnchanged: number;
  lootAdded: number;
  salesAdded: number;
  problems: string[];
};

/** Default Windows LocalLow game folder for this user, when we can resolve it. */
export function suggestedWatchPath(): string | null {
  const home = process.env.USERPROFILE || process.env.HOME;
  if (!home) return null;
  if (process.platform === "win32") {
    return path.join(home, "AppData", "LocalLow", "Niche Worlds Cult", "Monsters and Memories");
  }
  return null;
}

/**
 * Social ledgers often repeat the same act_13 as the Character ledger for
 * local characters, with slightly different fields → different dedupe keys
 * and double counts when stacked. Character files are the source of truth for
 * on-machine people; Social only adds other players (party / show-everyone).
 */
export function socialLootToKeep(
  events: ParsedLoot[],
  allowed: Set<string>,
  everyone: boolean,
  onMachine: Set<string> = new Set(),
): ParsedLoot[] {
  return events.filter((event) => {
    const who = itemKey(event.characterName);
    if (onMachine.has(who)) return false;
    if (everyone) return true;
    return allowed.has(who);
  });
}

export function setShowEveryone(enabled: boolean): boolean {
  const db = getDb();
  setSetting(db, "show_everyone", enabled ? "1" : "0");
  if (enabled) invalidateSocialFiles(db);
  scanNow();
  return enabled;
}

const globalStatus = globalThis as unknown as {
  scanStatus?: ScanSnapshot;
  scanLock?: boolean;
};

function emptySnapshot(watchPath: string | null): ScanSnapshot {
  return {
    watchPath,
    suggestedPath: suggestedWatchPath(),
    lastScanAt: null,
    scanning: false,
    filesSeen: 0,
    filesRead: 0,
    filesUnchanged: 0,
    lootAdded: 0,
    salesAdded: 0,
    problems: [],
  };
}

export function getScanSnapshot(): ScanSnapshot {
  if (!globalStatus.scanStatus) {
    const db = getDb();
    globalStatus.scanStatus = emptySnapshot(getSetting(db, "watch_path"));
    const saved = getSetting(db, "last_scan");
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Partial<ScanSnapshot>;
        globalStatus.scanStatus = {
          ...globalStatus.scanStatus,
          ...parsed,
          watchPath: getSetting(db, "watch_path"),
          suggestedPath: suggestedWatchPath(),
          scanning: false,
        };
      } catch {
        // Ignore a corrupt saved summary and scan again.
      }
    }
  }
  return globalStatus.scanStatus;
}

export function setWatchPath(rawPath: string): ScanSnapshot {
  const cleaned = rawPath.trim().replace(/^["']|["']$/g, "");
  if (!cleaned) {
    throw new Error(ErrorCode.watchNeedPath);
  }
  if (!path.isAbsolute(cleaned)) {
    throw new Error(ErrorCode.watchNeedAbsolute);
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(cleaned);
  } catch {
    throw new Error(ErrorCode.watchMissingFolder);
  }
  if (!stat.isDirectory()) {
    throw new Error(ErrorCode.watchNeedDirectory);
  }

  const db = getDb();
  setSetting(db, "watch_path", cleaned);
  const snapshot = { ...getScanSnapshot(), watchPath: cleaned };
  globalStatus.scanStatus = snapshot;
  return scanNow();
}

export function scanNow(): ScanSnapshot {
  if (globalStatus.scanLock) {
    return { ...getScanSnapshot(), scanning: true };
  }
  globalStatus.scanLock = true;
  const current = getScanSnapshot();
  globalStatus.scanStatus = { ...current, scanning: true };
  try {
    const next = scanUnlocked(current.watchPath);
    const quiet =
      next.filesRead === 0 &&
      next.lootAdded === 0 &&
      next.salesAdded === 0 &&
      next.watchPath === current.watchPath &&
      next.problems.join("\n") === current.problems.join("\n");
    if (quiet) {
      next.lastScanAt = current.lastScanAt;
    } else {
      setSetting(getDb(), "last_scan", JSON.stringify({ ...next, scanning: false }));
    }
    globalStatus.scanStatus = next;
    return next;
  } finally {
    globalStatus.scanLock = false;
    if (globalStatus.scanStatus) globalStatus.scanStatus.scanning = false;
  }
}

function scanUnlocked(watchPath: string | null): ScanSnapshot {
  const snapshot = emptySnapshot(watchPath);
  if (!watchPath) return snapshot;
  snapshot.lastScanAt = new Date().toISOString();

  let stat: fs.Stats;
  try {
    stat = fs.statSync(watchPath);
  } catch {
    snapshot.problems = ["Le dossier indiqué n'est plus accessible."];
    return snapshot;
  }
  if (!stat.isDirectory()) {
    snapshot.problems = ["Le chemin indiqué n'est plus un dossier."];
    return snapshot;
  }

  const files: string[] = [];
  const walkNotes: string[] = [];
  walkLedgerFiles(watchPath, 0, files, walkNotes);
  snapshot.filesSeen = files.length;
  snapshot.problems.push(...walkNotes);

  const db = getDb();
  syncCharactersFromWatch(db);
  const everyone = showEveryone(db);
  if (!everyone) dropHiddenPlayers(db);
  const allowed = allowedCharacterNames(db);
  const onMachine = onMachineCharacterNames(db);
  const stateStmt = db.prepare("SELECT signature, last_error FROM file_state WHERE path = ?");
  const saveState = db.prepare(
    `INSERT INTO file_state (path, signature, last_error, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET
       signature = excluded.signature,
       last_error = excluded.last_error,
       updated_at = excluded.updated_at`,
  );
  const now = new Date().toISOString();
  let added = 0;
  let salesAdded = 0;

  for (const file of files) {
    const owner = ownerFromLedgerPath(file);
    if (owner) rememberCharacter(db, owner.name, owner.serverName, true);

    let fileStat: fs.Stats;
    try {
      fileStat = fs.statSync(file);
    } catch {
      snapshot.problems.push(`${path.basename(file)} : unreadable file.`);
      continue;
    }
    if (fileStat.size > 20_000_000) {
      snapshot.problems.push(`${path.basename(file)} : file too large, skipped.`);
      continue;
    }
    const kind = ledgerFileKind(path.basename(file));
    // v4 re-reads character files once so a sale already stored picks up its zone.
    // Loot dedupe keys are unchanged. Social files stay on v2.
    // Bump prefixes when the parser gains new action codes so existing files are re-read.
    const signature = `${kind === "character" ? "v5" : "v3"}:${fileStat.size}:${fileStat.mtimeMs}`;
    const previous = stateStmt.get(file) as { signature: string; last_error: string | null } | undefined;
    if (previous?.signature === signature) {
      snapshot.filesUnchanged += 1;
      if (previous.last_error) snapshot.problems.push(previous.last_error);
      continue;
    }

    let parsed;
    try {
      const text = readLedgerText(file);
      parsed = parseLedgerDocument(JSON.parse(text) as unknown, contextFromPath(file));
    } catch {
      const message = `${path.basename(file)} : unreadable JSON.`;
      snapshot.problems.push(message);
      saveState.run(file, signature, message, now);
      snapshot.filesRead += 1;
      continue;
    }

    snapshot.filesRead += 1;
    const relative = path.basename(file);
    if (parsed.problem) {
      const message = `${relative} : ${parsed.problem}`;
      snapshot.problems.push(message);
      saveState.run(file, signature, message, now);
      continue;
    }

    let ingest: IngestResult = { added: 0, duplicate: 0, suppressed: 0 };
    let sold: IngestResult = { added: 0, duplicate: 0, suppressed: 0 };
    const social = kind === "social";
    const loot = social ? socialLootToKeep(parsed.loot, allowed, everyone, onMachine) : parsed.loot;
    try {
      ingest = ingestLoot(db, loot);
      if (!social && parsed.sales.length > 0) sold = ingestSales(db, parsed.sales);
      if (social) ingestPartyEvents(db, parsed.partyEvents);
    } catch {
      const message = `${relative} : could not save.`;
      snapshot.problems.push(message);
      saveState.run(file, signature, message, now);
      continue;
    }
    added += ingest.added;
    salesAdded += sold.added;

    const notes: string[] = [];
    if (parsed.lootEventCount === 0 && parsed.eventCount > 0) {
      const codes = parsed.actionCodes.length ? ` (${parsed.actionCodes.join(", ")})` : "";
      notes.push(
        `${relative} : ${parsed.eventCount} ${parsed.eventCount === 1 ? "event" : "events"}, no act_13 loot${codes}.`,
      );
    }
    if (parsed.skippedWithoutItem > 0) {
      notes.push(
        `${relative} : ${parsed.skippedWithoutItem} loot ${parsed.skippedWithoutItem === 1 ? "line" : "lines"} without an item name (d04), skipped.`,
      );
    }
    if (parsed.skippedWithoutCharacter > 0) {
      notes.push(
        `${relative} : ${parsed.skippedWithoutCharacter} loot ${parsed.skippedWithoutCharacter === 1 ? "line" : "lines"} without a character name, skipped.`,
      );
    }
    const problem = notes.join(" ");
    if (problem) snapshot.problems.push(problem);
    saveState.run(file, signature, problem || null, now);
  }

  snapshot.lootAdded = added;
  snapshot.salesAdded = salesAdded;
  snapshot.problems = snapshot.problems.slice(0, 12);
  return snapshot;
}

export function syncCharactersFromWatch(db: ReturnType<typeof getDb>) {
  const watchPath = getSetting(db, "watch_path");
  if (!watchPath) return;
  const files: string[] = [];
  walkLedgerFiles(watchPath, 0, files, []);
  for (const file of files) {
    const owner = ownerFromLedgerPath(file);
    if (owner) rememberCharacter(db, owner.name, owner.serverName, true);
  }
}

function onMachineCharacterNames(db: ReturnType<typeof getDb>): Set<string> {
  const names = new Set<string>();
  const machine = db.prepare("SELECT name FROM people WHERE on_machine = 1").all() as Array<{ name: string }>;
  for (const row of machine) names.add(itemKey(row.name));
  return names;
}

function allowedCharacterNames(db: ReturnType<typeof getDb>): Set<string> {
  const names = onMachineCharacterNames(db);
  const party = db
    .prepare(
      `SELECT pp.label AS name
       FROM party_presence pp
       JOIN parties pa ON pa.id = pp.party_id AND pa.status = 'open'`,
    )
    .all() as Array<{ name: string }>;
  for (const row of party) names.add(itemKey(row.name));
  return names;
}

function walkLedgerFiles(dir: string, depth: number, out: string[], notes: string[]) {
  if (depth > 5 || out.length >= 400) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    notes.push(`Impossible de lire ${dir}.`);
    return;
  }
  for (const entry of entries) {
    if (out.length >= 400) {
      notes.push("Lecture arrêtée après 400 fichiers Ledger.");
      return;
    }
    if (entry.name.startsWith(".")) continue;
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkLedgerFiles(full, depth + 1, out, notes);
    } else if (entry.isFile() && ledgerFileKind(entry.name)) {
      out.push(full);
    }
  }
}
