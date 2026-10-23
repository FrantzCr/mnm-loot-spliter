import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { ErrorCode } from "./codes";
import { characterKey, cleanText, itemKey } from "./format";
import { isValidCopper } from "./money";
import { COIN_LOOT_ITEM_NAME, type ParsedLoot, type ParsedSale } from "./ledger-parse";
import { unitPriceFromSale } from "./sale-price";

const globalForDb = globalThis as unknown as { registreDb?: DatabaseSync; registreSchema?: number };

const SCHEMA = 7;

const APP_DATA_DIR = "mnm-loot-spliter";
const LEGACY_APP_DATA_DIRS = ["loot-spliter"] as const;

function databaseFile(): string {
  const root = process.env.LOCALAPPDATA || path.join(process.cwd(), "data");
  const dir = path.join(root, APP_DATA_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "registre.sqlite");
  if (!fs.existsSync(file)) {
    const candidates = [
      ...LEGACY_APP_DATA_DIRS.map((name) => path.join(root, name, "registre.sqlite")),
      path.join(process.cwd(), "data", "registre.sqlite"),
    ];
    for (const legacy of candidates) {
      if (!fs.existsSync(legacy)) continue;
      fs.copyFileSync(legacy, file);
      for (const suffix of ["-wal", "-shm"]) {
        const from = `${legacy}${suffix}`;
        if (fs.existsSync(from)) fs.copyFileSync(from, `${file}${suffix}`);
      }
      break;
    }
  }
  return file;
}

export function getDb(): DatabaseSync {
  if (!globalForDb.registreDb) {
    globalForDb.registreDb = openDatabase(databaseFile());
    globalForDb.registreSchema = SCHEMA;
    return globalForDb.registreDb;
  }
  if (globalForDb.registreSchema !== SCHEMA) {
    migrate(globalForDb.registreDb);
    globalForDb.registreSchema = SCHEMA;
  }
  return globalForDb.registreDb;
}

export function openDatabase(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 4000");
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS people (
      id TEXT PRIMARY KEY,
      character_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      server_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS price_book (
      id TEXT PRIMARY KEY,
      item_key TEXT NOT NULL UNIQUE,
      item_name TEXT NOT NULL,
      unit_copper INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS loot_entries (
      id TEXT PRIMARY KEY,
      dedupe_key TEXT NOT NULL UNIQUE,
      person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      item_name TEXT NOT NULL,
      item_key TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      looted_at TEXT NOT NULL,
      source TEXT,
      zone TEXT,
      note TEXT,
      unit_copper INTEGER,
      user_edited INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS suppressed_loot (
      dedupe_key TEXT PRIMARY KEY,
      suppressed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS file_state (
      path TEXT PRIMARY KEY,
      signature TEXT NOT NULL,
      last_error TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_loot_person ON loot_entries(person_id, looted_at);

    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      dedupe_key TEXT NOT NULL UNIQUE,
      person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      item_name TEXT NOT NULL,
      item_key TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      sold_at TEXT NOT NULL,
      copper INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sales_person ON sales(person_id, sold_at);

    CREATE TABLE IF NOT EXISTS sale_price_decisions (
      item_key TEXT NOT NULL,
      unit_copper INTEGER NOT NULL,
      decision TEXT NOT NULL,
      decided_at TEXT NOT NULL,
      PRIMARY KEY (item_key, unit_copper)
    );

    CREATE TABLE IF NOT EXISTS parties (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      status TEXT NOT NULL,
      headcount INTEGER,
      mode TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS party_members (
      party_id TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
      person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      PRIMARY KEY (party_id, person_id)
    );

    CREATE TABLE IF NOT EXISTS party_presence (
      id TEXT PRIMARY KEY,
      party_id TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
      person_id TEXT REFERENCES people(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      joined_at TEXT NOT NULL,
      left_at TEXT,
      settled_at TEXT
    );

    CREATE TABLE IF NOT EXISTS party_settlements (
      id TEXT PRIMARY KEY,
      party_id TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
      from_presence_id TEXT NOT NULL,
      to_presence_id TEXT NOT NULL,
      copper INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pending_resale (
      id TEXT PRIMARY KEY,
      item_key TEXT NOT NULL UNIQUE,
      item_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_copper INTEGER,
      party_id TEXT REFERENCES parties(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dismissed_recent_players (
      dismiss_key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      person_id TEXT,
      dismissed_at TEXT NOT NULL
    );
  `);

  const lootColumns = db.prepare("PRAGMA table_info(loot_entries)").all() as Array<{ name: string }>;
  if (!lootColumns.some((column) => column.name === "group_id")) {
    db.exec(
      "ALTER TABLE loot_entries ADD COLUMN group_id TEXT REFERENCES parties(id) ON DELETE SET NULL",
    );
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_loot_group ON loot_entries(group_id)");
  const saleColumns = db.prepare("PRAGMA table_info(sales)").all() as Array<{ name: string }>;
  if (!saleColumns.some((column) => column.name === "zone")) {
    db.exec("ALTER TABLE sales ADD COLUMN zone TEXT");
  }
  const decisionColumns = db.prepare("PRAGMA table_info(sale_price_decisions)").all() as Array<{ name: string }>;
  if (!decisionColumns.some((column) => column.name === "sold_at")) {
    db.exec("ALTER TABLE sale_price_decisions ADD COLUMN sold_at TEXT");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_presence_party ON party_presence(party_id)");
  const peopleColumns = db.prepare("PRAGMA table_info(people)").all() as Array<{ name: string }>;
  if (!peopleColumns.some((column) => column.name === "on_machine")) {
    db.exec("ALTER TABLE people ADD COLUMN on_machine INTEGER NOT NULL DEFAULT 0");
  }
  backfillPresence(db);
}

function backfillPresence(db: DatabaseSync) {
  const parties = db.prepare("SELECT id, started_at, headcount FROM parties").all() as Array<{
    id: string;
    started_at: string;
    headcount: number | bigint | null;
  }>;
  const countPresence = db.prepare("SELECT COUNT(*) AS n FROM party_presence WHERE party_id = ?");
  const members = db.prepare(
    `SELECT m.person_id, p.name
     FROM party_members m
     JOIN people p ON p.id = m.person_id
     WHERE m.party_id = ?
     ORDER BY p.name COLLATE NOCASE`,
  );
  const insert = db.prepare(
    `INSERT INTO party_presence (id, party_id, person_id, label, joined_at, left_at, settled_at)
     VALUES (?, ?, ?, ?, ?, NULL, NULL)`,
  );
  for (const party of parties) {
    const existing = countPresence.get(party.id) as { n: number | bigint };
    if (Number(existing.n) > 0) continue;
    const seated = members.all(party.id) as Array<{ person_id: string; name: string }>;
    for (const member of seated) {
      insert.run(crypto.randomUUID(), party.id, member.person_id, member.name, party.started_at);
    }
    const headcount = party.headcount == null ? seated.length : Number(party.headcount);
    for (let index = seated.length; index < headcount; index += 1) {
      insert.run(crypto.randomUUID(), party.id, null, `Part ${index + 1}`, party.started_at);
    }
  }
}

export function getSetting(db: DatabaseSync, key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(db: DatabaseSync, key: string, value: string) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value
     WHERE settings.value IS NOT excluded.value`,
  ).run(key, value);
}

export type IngestResult = {
  added: number;
  duplicate: number;
  suppressed: number;
};

export function rememberCharacter(
  db: DatabaseSync,
  name: string,
  serverName: string | null,
  onMachine = false,
) {
  const cleaned = cleanText(name, 80);
  if (!cleaned) return;
  const server = cleanText(serverName, 80);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO people (id, character_key, name, server_name, on_machine, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(character_key) DO UPDATE SET
       server_name = COALESCE(people.server_name, excluded.server_name),
       on_machine = MAX(people.on_machine, excluded.on_machine),
       updated_at = excluded.updated_at
     WHERE people.server_name IS NOT COALESCE(people.server_name, excluded.server_name)
        OR people.on_machine IS NOT MAX(people.on_machine, excluded.on_machine)`,
  ).run(crypto.randomUUID(), characterKey(server, cleaned), cleaned, server, onMachine ? 1 : 0, now, now);
}

export function showEveryone(db: DatabaseSync): boolean {
  return getSetting(db, "show_everyone") === "1";
}

export function dropHiddenPlayers(db: DatabaseSync) {
  if (showEveryone(db)) return;
  db.prepare(
    `DELETE FROM people
     WHERE on_machine = 0
       AND NOT EXISTS (
         SELECT 1
         FROM party_presence pp
         JOIN parties pa ON pa.id = pp.party_id AND pa.status = 'open'
         WHERE pp.person_id = people.id
            OR pp.label = people.name COLLATE NOCASE
       )`,
  ).run();
}

export function invalidateSocialFiles(db: DatabaseSync) {
  const rows = db.prepare("SELECT path FROM file_state").all() as Array<{ path: string }>;
  const remove = db.prepare("DELETE FROM file_state WHERE path = ?");
  for (const row of rows) {
    if (path.basename(row.path).toLowerCase().includes("_social_")) remove.run(row.path);
  }
}

function groupForLoot(
  party: { id: string; started_at: string } | undefined,
  lootedAt: string,
): string | null {
  if (!party) return null;
  const at = Date.parse(lootedAt);
  const start = Date.parse(party.started_at);
  if (Number.isNaN(at) || Number.isNaN(start) || at < start) return null;
  return party.id;
}

export function ingestLoot(db: DatabaseSync, events: ParsedLoot[]): IngestResult {
  const result: IngestResult = { added: 0, duplicate: 0, suppressed: 0 };
  const now = new Date().toISOString();
  const suppressedStmt = db.prepare("SELECT 1 AS hit FROM suppressed_loot WHERE dedupe_key = ?");
  const existingStmt = db.prepare("SELECT 1 AS hit FROM loot_entries WHERE dedupe_key = ?");
  const findPerson = db.prepare("SELECT id FROM people WHERE character_key = ?");
  const openParty = db.prepare("SELECT id, started_at FROM parties WHERE status = 'open'").get() as
    | { id: string; started_at: string }
    | undefined;
  const insertLoot = db.prepare(
    `INSERT INTO loot_entries (
       id, dedupe_key, person_id, item_name, item_key, quantity, looted_at,
       source, zone, note, unit_copper, user_edited, created_at, updated_at, group_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 0, ?, ?, ?)
     ON CONFLICT(dedupe_key) DO NOTHING`,
  );

  db.exec("BEGIN");
  try {
    for (const event of events) {
      if (suppressedStmt.get(event.dedupeKey)) {
        result.suppressed += 1;
        continue;
      }
      if (existingStmt.get(event.dedupeKey)) {
        result.duplicate += 1;
        continue;
      }
      const key = characterKey(event.serverName, event.characterName);
      rememberCharacter(db, event.characterName, event.serverName);
      const person = findPerson.get(key) as { id: string } | undefined;
      if (!person) continue;
      const unitCopper =
        event.unitCopper != null && isValidCopper(event.unitCopper) ? event.unitCopper : null;
      const info = insertLoot.run(
        crypto.randomUUID(),
        event.dedupeKey,
        person.id,
        event.itemName,
        itemKey(event.itemName),
        event.quantity,
        event.lootedAt,
        event.source,
        event.zone,
        unitCopper,
        now,
        now,
        groupForLoot(openParty, event.lootedAt),
      );
      if (Number(info.changes) > 0) result.added += 1;
      else result.duplicate += 1;
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return result;
}

export function ingestSales(db: DatabaseSync, events: ParsedSale[]): IngestResult {
  const result: IngestResult = { added: 0, duplicate: 0, suppressed: 0 };
  const now = new Date().toISOString();
  const existingStmt = db.prepare("SELECT 1 AS hit FROM sales WHERE dedupe_key = ?");
  const fillZone = db.prepare(
    "UPDATE sales SET zone = ? WHERE dedupe_key = ? AND (zone IS NULL OR zone = '')",
  );
  const findPerson = db.prepare("SELECT id FROM people WHERE character_key = ?");
  const insertSale = db.prepare(
    `INSERT INTO sales (
       id, dedupe_key, person_id, item_name, item_key, quantity, sold_at, copper, zone, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(dedupe_key) DO NOTHING`,
  );
  db.exec("BEGIN");
  try {
    for (const event of events) {
      if (existingStmt.get(event.dedupeKey)) {
        if (event.zone) fillZone.run(event.zone, event.dedupeKey);
        result.duplicate += 1;
        continue;
      }
      const key = characterKey(event.serverName, event.characterName);
      rememberCharacter(db, event.characterName, event.serverName);
      const person = findPerson.get(key) as { id: string } | undefined;
      if (!person) continue;
      const saleKey = itemKey(event.itemName);
      const info = insertSale.run(
        crypto.randomUUID(),
        event.dedupeKey,
        person.id,
        event.itemName,
        saleKey,
        event.quantity,
        event.soldAt,
        event.copper,
        event.zone,
        now,
      );
      if (Number(info.changes) > 0) {
        result.added += 1;
        clearPendingResaleForSale(db, saleKey, event.quantity);
        // First known vendor unit price fills the book automatically; conflicts stay manual.
        adoptSalePriceIfMissing(db, event.itemName, saleKey, event.quantity, event.copper, event.soldAt);
      } else result.duplicate += 1;
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return result;
}

/** When the book has no price yet, take a clean vendor unit price without asking. */
function adoptSalePriceIfMissing(
  db: DatabaseSync,
  itemName: string,
  saleKey: string,
  quantity: number,
  copper: number | null,
  soldAt: string,
) {
  const unit = unitPriceFromSale(quantity, copper);
  if (unit == null || !isValidCopper(unit)) return;
  const existing = db.prepare("SELECT 1 AS hit FROM price_book WHERE item_key = ?").get(saleKey) as
    | { hit: number }
    | undefined;
  if (existing) return;
  upsertPrice(db, itemName, unit);
  recordSalePriceDecision(db, saleKey, unit, "replace", soldAt);
}

/** Drop or shrink the post-group sell queue when a matching vendor sale is recorded. */
function clearPendingResaleForSale(db: DatabaseSync, saleKey: string, quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 1) return;
  const row = db.prepare("SELECT id, quantity FROM pending_resale WHERE item_key = ?").get(saleKey) as
    | { id: string; quantity: number | bigint }
    | undefined;
  if (!row) return;
  const remaining = asNumber(row.quantity);
  const next = remaining - quantity;
  if (next <= 0) {
    db.prepare("DELETE FROM pending_resale WHERE id = ?").run(row.id);
    return;
  }
  db.prepare("UPDATE pending_resale SET quantity = ?, updated_at = ? WHERE id = ?").run(
    next,
    new Date().toISOString(),
    row.id,
  );
}

export function upsertPrice(db: DatabaseSync, itemName: string, unitCopper: number) {
  if (!isValidCopper(unitCopper)) {
    throw new Error(ErrorCode.priceInvalid);
  }
  const name = cleanText(itemName, 120);
  if (!name) throw new Error(ErrorCode.itemNeedName);
  if (itemKey(name) === itemKey(COIN_LOOT_ITEM_NAME)) {
    throw new Error(ErrorCode.priceInvalid);
  }
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO price_book (id, item_key, item_name, unit_copper, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(item_key) DO UPDATE SET
       item_name = excluded.item_name,
       unit_copper = excluded.unit_copper,
       updated_at = excluded.updated_at`,
  ).run(crypto.randomUUID(), itemKey(name), name, unitCopper, now);
  applyBookPrice(db, itemKey(name), unitCopper);
}

export function applyBookPrice(db: DatabaseSync, key: string, unitCopper: number) {
  // Corpse coin lines (act_14) keep the copper from the ledger.
  if (key === itemKey(COIN_LOOT_ITEM_NAME)) return;
  db.prepare("UPDATE loot_entries SET unit_copper = ?, updated_at = ? WHERE item_key = ?").run(
    unitCopper,
    new Date().toISOString(),
    key,
  );
}

export function recordSalePriceDecision(
  db: DatabaseSync,
  key: string,
  unitCopper: number,
  decision: "keep" | "replace",
  soldAt: string,
) {
  db.prepare(
    `INSERT INTO sale_price_decisions (item_key, unit_copper, decision, decided_at, sold_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(item_key, unit_copper) DO UPDATE SET
       decision = excluded.decision,
       decided_at = excluded.decided_at,
       sold_at = excluded.sold_at`,
  ).run(key, unitCopper, decision, new Date().toISOString(), soldAt);
}

export function asNumber(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  return 0;
}
