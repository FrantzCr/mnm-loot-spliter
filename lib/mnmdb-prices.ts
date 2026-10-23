import type { DatabaseSync } from "node:sqlite";

import { ErrorCode } from "./codes";
import { applyBookPrice, getDb, getSetting, setSetting } from "./db";
import { cleanText, itemKey } from "./format";
import { COIN_LOOT_ITEM_NAME } from "./ledger-parse";
import { isValidCopper } from "./money";

export const MNMDB_DATA_URL = "https://mnm-db.com/data.json";
export const MNMDB_SOURCE_LABEL = "mnm-db.com (mnm-tools community vendor sales)";
export const MNMDB_IMPORT_SETTING = "mnmdb_price_import";

/** Cap remote payload so a runaway response cannot fill disk/memory. */
export const MNMDB_MAX_BYTES = 5 * 1024 * 1024;

export type MnmdbPriceObservation = {
  copper: number;
  count: number;
};

export type MnmdbItem = {
  name: string;
  prices?: MnmdbPriceObservation[];
};

export type MnmdbDataset = {
  generatedAt?: string;
  source?: string;
  items?: MnmdbItem[];
};

export type MnmdbImportResult = {
  added: number;
  skippedExisting: number;
  skippedInvalid: number;
  considered: number;
  source: string;
  datasetGeneratedAt: string | null;
  importedAt: string;
};

/**
 * Weighted average of community vendor-sale observations, rounded to copper.
 * `count` is how many times that unit price was seen.
 */
export function weightedUnitCopper(prices: MnmdbPriceObservation[]): number | null {
  let weighted = 0;
  let total = 0;
  for (const entry of prices) {
    if (!Number.isFinite(entry.copper) || !Number.isFinite(entry.count)) continue;
    const copper = Math.trunc(entry.copper);
    const count = Math.trunc(entry.count);
    if (copper < 0 || count <= 0) continue;
    weighted += copper * count;
    total += count;
  }
  if (total === 0) return null;
  const unit = Math.round(weighted / total);
  return isValidCopper(unit) ? unit : null;
}

export function parseMnmdbDataset(raw: unknown): {
  items: Array<{ itemName: string; unitCopper: number }>;
  generatedAt: string | null;
  source: string;
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(ErrorCode.mnmdbBadPayload);
  }
  const dataset = raw as MnmdbDataset;
  if (!Array.isArray(dataset.items)) throw new Error(ErrorCode.mnmdbBadPayload);

  const items: Array<{ itemName: string; unitCopper: number }> = [];
  for (const item of dataset.items) {
    if (!item || typeof item !== "object") continue;
    const name = cleanText(typeof item.name === "string" ? item.name : "", 120);
    if (!name) continue;
    if (itemKey(name) === itemKey(COIN_LOOT_ITEM_NAME)) continue;
    if (!Array.isArray(item.prices) || item.prices.length === 0) continue;
    const unitCopper = weightedUnitCopper(item.prices);
    if (unitCopper == null) continue;
    items.push({ itemName: name, unitCopper });
  }

  return {
    items,
    generatedAt: typeof dataset.generatedAt === "string" ? dataset.generatedAt : null,
    source: typeof dataset.source === "string" && dataset.source.trim() ? dataset.source.trim() : "mnm-tools",
  };
}

/** Insert only when the item has no row in price_book — never overwrite local prices. */
export function insertPriceIfAbsent(db: DatabaseSync, itemName: string, unitCopper: number): boolean {
  if (!isValidCopper(unitCopper)) return false;
  const name = cleanText(itemName, 120);
  if (!name) return false;
  const key = itemKey(name);
  if (key === itemKey(COIN_LOOT_ITEM_NAME)) return false;
  const existing = db.prepare("SELECT id FROM price_book WHERE item_key = ?").get(key) as { id: string } | undefined;
  if (existing) return false;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO price_book (id, item_key, item_name, unit_copper, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(crypto.randomUUID(), key, name, unitCopper, now);
  applyBookPrice(db, key, unitCopper);
  return true;
}

export function applyMnmdbPrices(
  entries: Array<{ itemName: string; unitCopper: number }>,
  meta: { generatedAt: string | null; source: string },
  db: DatabaseSync = getDb(),
): MnmdbImportResult {
  let added = 0;
  let skippedExisting = 0;
  let skippedInvalid = 0;

  db.exec("BEGIN");
  try {
    for (const entry of entries) {
      if (!isValidCopper(entry.unitCopper)) {
        skippedInvalid += 1;
        continue;
      }
      const inserted = insertPriceIfAbsent(db, entry.itemName, entry.unitCopper);
      if (inserted) added += 1;
      else skippedExisting += 1;
    }
    const importedAt = new Date().toISOString();
    const result: MnmdbImportResult = {
      added,
      skippedExisting,
      skippedInvalid,
      considered: entries.length,
      source: MNMDB_SOURCE_LABEL,
      datasetGeneratedAt: meta.generatedAt,
      importedAt,
    };
    setSetting(
      db,
      MNMDB_IMPORT_SETTING,
      JSON.stringify({
        ...result,
        datasetSource: meta.source,
      }),
    );
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export async function fetchMnmdbDataset(
  fetchImpl: typeof fetch = fetch,
  url: string = MNMDB_DATA_URL,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    throw new Error(ErrorCode.mnmdbFetchFailed);
  }
  if (!response.ok) throw new Error(ErrorCode.mnmdbFetchFailed);
  const lengthHeader = response.headers.get("content-length");
  if (lengthHeader && Number(lengthHeader) > MNMDB_MAX_BYTES) {
    throw new Error(ErrorCode.mnmdbTooLarge);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MNMDB_MAX_BYTES) throw new Error(ErrorCode.mnmdbTooLarge);
  try {
    return JSON.parse(buffer.toString("utf8")) as unknown;
  } catch {
    throw new Error(ErrorCode.mnmdbBadPayload);
  }
}

export async function importMnmdbPrices(fetchImpl: typeof fetch = fetch): Promise<MnmdbImportResult> {
  const raw = await fetchMnmdbDataset(fetchImpl);
  const parsed = parseMnmdbDataset(raw);
  if (parsed.items.length === 0) throw new Error(ErrorCode.mnmdbEmpty);
  return applyMnmdbPrices(parsed.items, {
    generatedAt: parsed.generatedAt,
    source: parsed.source,
  });
}

export function readMnmdbImportMeta(db: DatabaseSync = getDb()): MnmdbImportResult | null {
  const raw = getSetting(db, MNMDB_IMPORT_SETTING);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as MnmdbImportResult;
    if (!value || typeof value !== "object") return null;
    if (typeof value.importedAt !== "string" || typeof value.source !== "string") return null;
    return value;
  } catch {
    return null;
  }
}
