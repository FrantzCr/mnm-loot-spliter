import { createHash } from "node:crypto";
import path from "node:path";

import { characterKey } from "./format";
import { coinsToCopper, isValidCopper } from "./money";

/**
 * Ledger files written by the Monsters & Memories client, as documented
 * on the public wiki (Logfiles, build 0.29.0.1, updated 2026-09-13):
 * https://monstersandmemories.miraheze.org/wiki/Logfiles
 *
 * Read fields: c01, c05, f01, f03, f04, f05, f07, d02, d04, d05.
 * The client stores f03 either as an object or as a JSON string of that object.
 * d01 and d03 are part of the identity hash only. The wiki marks both
 * unknown, so a loot line never displays or counts them.
 * Loot is action code act_13. Quantity is one per event: the public
 * field list does not document a stack size on act_13.
 * Coins taken from a corpse are act_14 ("Interact with a Corpse").
 * Observed fields (not on the public wiki list): d11 = copper total,
 * d12 = "Pp,Gp,Sp,Cp", d13 = mob name, d14 = party_split | npc_corpse.
 * A vendor sale is act_24 ("Sell Item to a Vendor"). On that action the
 * character ledger puts the stack count in d01 and the proceeds in d03,
 * as base64 text "N platinum N gold N silver N copper". The zone is f05.
 * The sale line has no merchant name. A sale is not loot. Player trades
 * (act_16 / act_20) are ignored.
 */

const LEDGER_FILE = /^(.*)_(Character|Social)_(\d{4}-\d{2}-\d{2})\.json$/i;
const READABLE = /^[\p{L}\p{M}\p{N}\p{P}\p{Z}]{1,120}$/u;

/** Stable loot line name for corpse coin splits (act_14). Not a vendor item. */
export const COIN_LOOT_ITEM_NAME = "Coins";

export type ParsedLoot = {
  dedupeKey: string;
  characterName: string;
  serverName: string | null;
  itemName: string;
  quantity: number;
  lootedAt: string;
  source: string | null;
  zone: string | null;
  /** Set for act_14 corpse coins; item loot leaves this unset. */
  unitCopper?: number | null;
};

export type ParsedSale = {
  dedupeKey: string;
  characterName: string;
  serverName: string | null;
  itemName: string;
  quantity: number;
  soldAt: string;
  copper: number | null;
  zone: string | null;
};

export type ParseReport = {
  loot: ParsedLoot[];
  sales: ParsedSale[];
  eventCount: number;
  lootEventCount: number;
  skippedWithoutItem: number;
  skippedWithoutCharacter: number;
  actionCodes: string[];
  problem: string | null;
};

export type PathContext = {
  characterFromPath: string | null;
  serverFromPath: string | null;
  characterFromFile: string | null;
};

export function ledgerFileKind(fileName: string): "character" | "social" | null {
  const match = fileName.match(LEDGER_FILE);
  if (!match) return null;
  return match[2].toLowerCase() === "social" ? "social" : "character";
}

export function ownerFromLedgerPath(filePath: string): { name: string; serverName: string | null } | null {
  const origin = contextFromPath(filePath);
  const name = plainName(origin.characterFromFile) ?? plainName(origin.characterFromPath);
  if (!name) return null;
  return { name, serverName: plainName(origin.serverFromPath) };
}

export function contextFromPath(filePath: string): PathContext {
  const base = path.basename(filePath);
  const match = base.match(LEDGER_FILE);
  const parts = filePath.split(/[/\\]/).filter(Boolean);
  const ledgerIndex = parts.findIndex((part) => part.toLowerCase() === "ledger");
  return {
    characterFromFile: match?.[1] ? match[1] : null,
    characterFromPath: ledgerIndex >= 1 ? parts[ledgerIndex - 1] : null,
    serverFromPath: ledgerIndex >= 2 ? parts[ledgerIndex - 2] : null,
  };
}

export function decodeBase64Text(value: string): string | null {
  const compact = value.trim().replace(/\s+/g, "");
  if (!compact || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(compact)) return null;
  const normalized =
    compact.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (compact.length % 4)) % 4);
  const buf = Buffer.from(normalized, "base64");
  if (buf.length === 0) return null;
  const text = buf.toString("utf8").trim();
  if (!text || text.includes("\uFFFD") || /[\u0000-\u001f]/.test(text)) return null;
  if (!READABLE.test(text)) return null;
  return text;
}

export function parseLedgerDocument(json: unknown, origin: PathContext): ParseReport {
  const empty: ParseReport = {
    loot: [],
    sales: [],
    eventCount: 0,
    lootEventCount: 0,
    skippedWithoutItem: 0,
    skippedWithoutCharacter: 0,
    actionCodes: [],
    problem: null,
  };

  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return { ...empty, problem: "Not a JSON object." };
  }

  const root = json as Record<string, unknown>;
  if (!("c01" in root)) {
    return { ...empty, problem: "No c01 list (event log)." };
  }
  if (!Array.isArray(root.c01)) {
    return { ...empty, problem: "c01 is not a list." };
  }

  const ledgerName = plainName(root.c05);
  const seenCodes = new Set<string>();
  const ordinals = new Map<string, number>();
  const loot: ParsedLoot[] = [];
  const sales: ParsedSale[] = [];
  let lootEventCount = 0;
  let skippedWithoutItem = 0;
  let skippedWithoutCharacter = 0;

  for (const event of root.c01) {
    if (!event || typeof event !== "object" || Array.isArray(event)) continue;
    const record = event as Record<string, unknown>;
    const action = typeof record.f01 === "string" ? record.f01.trim() : "";
    if (action) seenCodes.add(action);
    const sale = action === "act_24";
    const corpseCoins = action === "act_14";
    if (action !== "act_13" && !sale && !corpseCoins) continue;
    if (!sale) lootEventCount += 1;

    const details = detailObjects(record.f03);
    if (details.length === 0) {
      if (!sale) skippedWithoutItem += 1;
      continue;
    }

    for (const detail of details) {
      const characterName =
        plainName(record.f07) ??
        ledgerName ??
        plainName(origin.characterFromPath) ??
        plainName(origin.characterFromFile);
      if (!characterName) {
        if (!sale) skippedWithoutCharacter += 1;
        continue;
      }

      const serverName = plainName(origin.serverFromPath);
      const at = typeof record.f04 === "string" ? record.f04.trim() : "";
      const zoneRaw = typeof record.f05 === "string" ? record.f05.trim() : "";
      const zone = zoneLabel(zoneRaw);

      if (corpseCoins) {
        const copper = corpseCopper(detail);
        const kind = corpseKind(detail.d14);
        if (copper == null || copper <= 0 || !kind) {
          skippedWithoutItem += 1;
          continue;
        }
        const fingerprint = eventFingerprint(origin.serverFromPath, characterName, action, record, detail);
        const ordinal = ordinals.get(fingerprint) ?? 0;
        ordinals.set(fingerprint, ordinal + 1);
        loot.push({
          dedupeKey: `${fingerprint}:${ordinal}`,
          characterName,
          serverName,
          itemName: COIN_LOOT_ITEM_NAME,
          quantity: 1,
          lootedAt: at,
          source: mobName(detail.d13) ?? mobName(detail.d02),
          zone,
          unitCopper: copper,
        });
        continue;
      }

      const itemName = plainName(detail.d04);
      if (!itemName) {
        if (!sale) skippedWithoutItem += 1;
        continue;
      }

      const fingerprint = eventFingerprint(origin.serverFromPath, characterName, action, record, detail);
      const ordinal = ordinals.get(fingerprint) ?? 0;
      ordinals.set(fingerprint, ordinal + 1);
      const dedupeKey = `${fingerprint}:${ordinal}`;

      if (sale) {
        sales.push({
          dedupeKey,
          characterName,
          serverName,
          itemName,
          quantity: saleQuantity(detail.d01),
          soldAt: at,
          copper: saleCopper(detail.d03),
          zone,
        });
        continue;
      }

      loot.push({
        dedupeKey,
        characterName,
        serverName,
        itemName,
        quantity: 1,
        lootedAt: at,
        source: mobName(detail.d02),
        zone,
      });
    }
  }

  return {
    loot,
    sales,
    eventCount: root.c01.length,
    lootEventCount,
    skippedWithoutItem,
    skippedWithoutCharacter,
    actionCodes: [...seenCodes].sort(),
    problem: null,
  };
}

function eventFingerprint(
  serverFromPath: string | null,
  characterName: string,
  action: string,
  record: Record<string, unknown>,
  detail: Record<string, unknown>,
): string {
  return createHash("sha256")
    .update(
      [
        characterKey(serverFromPath, characterName),
        stable({
          f01: action,
          f04: record.f04 ?? null,
          f05: record.f05 ?? null,
          f07: record.f07 ?? null,
          f09: record.f09 ?? null,
          d01: detail.d01 ?? null,
          d02: detail.d02 ?? null,
          d03: detail.d03 ?? null,
          d04: detail.d04 ?? null,
          d05: detail.d05 ?? null,
          d11: detail.d11 ?? null,
          d12: detail.d12 ?? null,
          d13: detail.d13 ?? null,
          d14: detail.d14 ?? null,
          d15: detail.d15 ?? null,
        }),
      ].join("|"),
    )
    .digest("hex");
}

const COIN_LINE = /^(\d+)\s+platinum\s+(\d+)\s+gold\s+(\d+)\s+silver\s+(\d+)\s+copper$/i;
const COIN_CSV = /^(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)$/;

function corpseKind(value: unknown): "party_split" | "npc_corpse" | null {
  const text = (typeof value === "string" ? decodeBase64Text(value) ?? value : "").trim().toLowerCase();
  if (text === "party_split" || text === "npc_corpse") return text;
  return null;
}

function corpseCopper(detail: Record<string, unknown>): number | null {
  if (typeof detail.d11 === "number" && Number.isInteger(detail.d11) && isValidCopper(detail.d11)) {
    return detail.d11;
  }
  if (typeof detail.d11 === "string" && /^\d+$/.test(detail.d11.trim())) {
    const n = Number(detail.d11.trim());
    if (isValidCopper(n)) return n;
  }
  if (typeof detail.d12 === "string") {
    const text = (decodeBase64Text(detail.d12) ?? detail.d12).trim();
    const match = text.match(COIN_CSV);
    if (match) {
      const copper = coinsToCopper({
        platinum: Number(match[1]),
        gold: Number(match[2]),
        silver: Number(match[3]),
        copper: Number(match[4]),
      });
      return isValidCopper(copper) ? copper : null;
    }
  }
  return null;
}

function saleQuantity(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 1_000_000) return value;
  return 1;
}

function saleCopper(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const text = (decodeBase64Text(value) ?? value).trim();
  const match = text.match(COIN_LINE);
  if (!match) return null;
  const copper = coinsToCopper({
    platinum: Number(match[1]),
    gold: Number(match[2]),
    silver: Number(match[3]),
    copper: Number(match[4]),
  });
  return isValidCopper(copper) ? copper : null;
}

function detailObjects(value: unknown): Record<string, unknown>[] {
  return detailsFrom(value, true);
}

function detailsFrom(value: unknown, parseString: boolean): Record<string, unknown>[] {
  if (parseString && typeof value === "string") {
    const text = value.trim();
    if (!text) return [];
    try {
      return detailsFrom(JSON.parse(text) as unknown, false);
    } catch {
      return [];
    }
  }
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is Record<string, unknown> =>
        !!item && typeof item === "object" && !Array.isArray(item),
    );
  }
  if (value && typeof value === "object") return [value as Record<string, unknown>];
  return [];
}

function plainName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!text || text.length > 80) return null;
  return text;
}

function mobName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const decoded = decodeBase64Text(value);
  if (decoded) return decoded;
  const plain = value.trim();
  if (!plain || /^[A-Za-z0-9+/_-]+=*$/.test(plain)) return null;
  return plainName(plain);
}

function zoneLabel(raw: string): string | null {
  if (!raw) return null;
  const prefixed = raw.match(/^zone_(.+)$/i);
  if (prefixed) {
    const decoded = decodeBase64Text(prefixed[1]);
    if (decoded) return decoded;
  }
  return raw;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
