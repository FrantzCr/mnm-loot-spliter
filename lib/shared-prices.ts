import type { DatabaseSync } from "node:sqlite";

import { ErrorCode } from "./codes";
import { getDb, getSetting, setSetting } from "./db";
import { cleanText, itemKey } from "./format";
import { COIN_LOOT_ITEM_NAME } from "./ledger-parse";
import { MNMDB_MAX_BYTES } from "./mnmdb-prices";
import { isValidCopper } from "./money";
import { extractPriceList, type PriceBookEntry } from "./price-import";

/** Price book export kept in the repository (shared/price-book.json), refreshed by the author. */
export const SHARED_PRICES_URL =
  "https://raw.githubusercontent.com/FrantzCr/mnm-loot-spliter/main/shared/price-book.json";
export const SHARED_PRICES_SETTING = "shared_price_import";

export type SharedPricesResult = {
  added: number;
  skippedExisting: number;
  considered: number;
  exportedAt: string | null;
  importedAt: string;
};

/**
 * Fill items with no local price straight into the price book. No sale decision is needed: a
 * local vendor sale already sets the price when there is none, so those items are skipped.
 * Loot lines pick the price up at once: unedited lines are set, hand-edited ones are left alone.
 */
export function applySharedPrices(
  entries: PriceBookEntry[],
  exportedAt: string | null,
  db: DatabaseSync = getDb(),
): SharedPricesResult {
  const exists = db.prepare("SELECT 1 AS hit FROM price_book WHERE item_key = ?");
  const insert = db.prepare(
    `INSERT INTO price_book (id, item_key, item_name, unit_copper, updated_at) VALUES (?, ?, ?, ?, ?)`,
  );
  const applyToLoot = db.prepare(
    "UPDATE loot_entries SET unit_copper = ?, updated_at = ? WHERE item_key = ? AND user_edited = 0",
  );  const now = new Date().toISOString();
  let added = 0;
  let skippedExisting = 0;
  db.exec("BEGIN");
  try {
    for (const entry of entries) {
      const name = cleanText(entry.itemName, 120);
      if (!name || !isValidCopper(entry.unitCopper)) continue;
      const key = itemKey(name);
      if (key === itemKey(COIN_LOOT_ITEM_NAME)) continue;
      if (exists.get(key)) {
        skippedExisting += 1;
        continue;
      }
      insert.run(crypto.randomUUID(), key, name, entry.unitCopper, now);
      applyToLoot.run(entry.unitCopper, now, key);
      added += 1;
    }
    const result: SharedPricesResult = { added, skippedExisting, considered: entries.length, exportedAt, importedAt: now };
    setSetting(db, SHARED_PRICES_SETTING, JSON.stringify(result));
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export async function importSharedPrices(fetchImpl: typeof fetch = fetch): Promise<SharedPricesResult> {
  let response: Response;
  try {
    response = await fetchImpl(SHARED_PRICES_URL, { headers: { Accept: "application/json" }, cache: "no-store" });
  } catch {
    throw new Error(ErrorCode.sharedPricesFetchFailed);
  }
  if (!response.ok) throw new Error(ErrorCode.sharedPricesFetchFailed);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MNMDB_MAX_BYTES) throw new Error(ErrorCode.priceImportTooLarge);
  let raw: unknown;
  try {
    raw = JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new Error(ErrorCode.priceImportBadFile);
  }
  const entries = extractPriceList(raw);
  if (!entries || entries.length === 0) throw new Error(ErrorCode.sharedPricesEmpty);
  const exportedAt =
    raw && typeof raw === "object" && typeof (raw as { exportedAt?: unknown }).exportedAt === "string"
      ? (raw as { exportedAt: string }).exportedAt
      : null;
  return applySharedPrices(entries, exportedAt);
}

export function readSharedPricesMeta(db: DatabaseSync = getDb()): SharedPricesResult | null {
  const raw = getSetting(db, SHARED_PRICES_SETTING);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as SharedPricesResult;
    return value && typeof value.importedAt === "string" ? value : null;
  } catch {
    return null;
  }
}
