import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { ErrorCode } from "./codes";
import { getDb, upsertPrice } from "./db";
import { cleanText, itemKey } from "./format";
import { COIN_LOOT_ITEM_NAME } from "./ledger-parse";
import { isValidCopper } from "./money";
import { noteMatchingSalePrice } from "./price-catalog";

function dbOrDefault(db?: DatabaseSync): DatabaseSync {
  return db ?? getDb();
}

export const PRICE_BOOK_EXPORT_FORMAT = "loot-spliter-prices";
export const PRICE_BOOK_EXPORT_VERSION = 1;

export type PriceBookEntry = {
  itemName: string;
  unitCopper: number;
};

export type PriceConflict = {
  itemKey: string;
  itemName: string;
  localCopper: number;
  importCopper: number;
};

export type PriceImportPreview = {
  total: number;
  added: number;
  unchanged: number;
  conflicts: PriceConflict[];
};

export type PriceImportMode = "keepLocal" | "replaceConflicts";

export type PriceImportResult = {
  added: number;
  replaced: number;
  skippedConflicts: number;
  unchanged: number;
};

export function exportPriceBook(db?: DatabaseSync): {
  format: typeof PRICE_BOOK_EXPORT_FORMAT;
  version: typeof PRICE_BOOK_EXPORT_VERSION;
  exportedAt: string;
  prices: PriceBookEntry[];
} {
  const rows = dbOrDefault(db)
    .prepare(
      `SELECT item_name, unit_copper
       FROM price_book
       ORDER BY item_name COLLATE NOCASE`,
    )
    .all() as Array<{ item_name: string; unit_copper: number | bigint }>;
  return {
    format: PRICE_BOOK_EXPORT_FORMAT,
    version: PRICE_BOOK_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    prices: rows.map((row) => ({
      itemName: row.item_name,
      unitCopper: Number(row.unit_copper),
    })),
  };
}

export function parsePriceImportBytes(bytes: Uint8Array, fileName: string): PriceBookEntry[] {
  if (bytes.length === 0) throw new Error(ErrorCode.priceImportEmpty);
  const lower = fileName.toLocaleLowerCase("fr");
  if (looksLikeSqlite(bytes) || lower.endsWith(".sqlite") || lower.endsWith(".db")) {
    return readPricesFromSqlite(bytes);
  }
  return readPricesFromJson(Buffer.from(bytes).toString("utf8"));
}

export function previewPriceImport(entries: PriceBookEntry[], db?: DatabaseSync): PriceImportPreview {
  const incoming = normalizeEntries(entries);
  const local = localPriceMap(db);
  const conflicts: PriceConflict[] = [];
  let added = 0;
  let unchanged = 0;
  for (const entry of incoming.values()) {
    const current = local.get(entry.itemKey);
    if (!current) {
      added += 1;
      continue;
    }
    if (current.unitCopper === entry.unitCopper) {
      unchanged += 1;
      continue;
    }
    conflicts.push({
      itemKey: entry.itemKey,
      itemName: entry.itemName,
      localCopper: current.unitCopper,
      importCopper: entry.unitCopper,
    });
  }
  conflicts.sort((a, b) => a.itemName.localeCompare(b.itemName, "fr"));
  return { total: incoming.size, added, unchanged, conflicts };
}

export function applyPriceImport(
  entries: PriceBookEntry[],
  mode: PriceImportMode,
  db?: DatabaseSync,
): PriceImportResult {
  const store = dbOrDefault(db);
  const incoming = normalizeEntries(entries);
  const local = localPriceMap(store);
  let added = 0;
  let replaced = 0;
  let skippedConflicts = 0;
  let unchanged = 0;

  store.exec("BEGIN");
  try {
    for (const entry of incoming.values()) {
      const current = local.get(entry.itemKey);
      if (!current) {
        upsertPrice(store, entry.itemName, entry.unitCopper);
        noteMatchingSalePrice(store, entry.itemName, entry.unitCopper);
        added += 1;
        continue;
      }
      if (current.unitCopper === entry.unitCopper) {
        unchanged += 1;
        continue;
      }
      if (mode === "keepLocal") {
        skippedConflicts += 1;
        continue;
      }
      upsertPrice(store, entry.itemName, entry.unitCopper);
      noteMatchingSalePrice(store, entry.itemName, entry.unitCopper);
      replaced += 1;
    }
    store.exec("COMMIT");
  } catch (error) {
    store.exec("ROLLBACK");
    throw error;
  }

  return {
    added,
    replaced,
    skippedConflicts,
    unchanged,
  };
}

function localPriceMap(db?: DatabaseSync): Map<string, { itemName: string; unitCopper: number }> {
  const rows = dbOrDefault(db)
    .prepare("SELECT item_key, item_name, unit_copper FROM price_book")
    .all() as Array<{ item_key: string; item_name: string; unit_copper: number | bigint }>;
  return new Map(
    rows.map((row) => [
      row.item_key,
      { itemName: row.item_name, unitCopper: Number(row.unit_copper) },
    ]),
  );
}

function normalizeEntries(entries: PriceBookEntry[]): Map<string, { itemKey: string; itemName: string; unitCopper: number }> {
  const out = new Map<string, { itemKey: string; itemName: string; unitCopper: number }>();
  for (const entry of entries) {
    const name = cleanText(entry.itemName, 120);
    if (!name) continue;
    if (itemKey(name) === itemKey(COIN_LOOT_ITEM_NAME)) continue;
    if (!isValidCopper(entry.unitCopper)) continue;
    const key = itemKey(name);
    out.set(key, { itemKey: key, itemName: name, unitCopper: entry.unitCopper });
  }
  if (out.size === 0) throw new Error(ErrorCode.priceImportEmpty);
  return out;
}

function looksLikeSqlite(bytes: Uint8Array): boolean {
  if (bytes.length < 16) return false;
  const header = Buffer.from(bytes.subarray(0, 15)).toString("utf8");
  return header === "SQLite format 3";
}

function readPricesFromSqlite(bytes: Uint8Array): PriceBookEntry[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loot-spliter-price-"));
  const file = path.join(dir, "import.sqlite");
  try {
    fs.writeFileSync(file, bytes);
    const foreign = new DatabaseSync(file, { readOnly: true });
    try {
      const tables = foreign
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'price_book'")
        .get() as { name: string } | undefined;
      if (!tables) throw new Error(ErrorCode.priceImportBadFile);
      const rows = foreign
        .prepare("SELECT item_name, unit_copper FROM price_book")
        .all() as Array<{ item_name: string; unit_copper: number | bigint }>;
      return rows.map((row) => ({
        itemName: row.item_name,
        unitCopper: Number(row.unit_copper),
      }));
    } finally {
      foreign.close();
    }
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

function readPricesFromJson(text: string): PriceBookEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error(ErrorCode.priceImportBadFile);
  }
  const list = extractPriceList(parsed);
  if (!list) throw new Error(ErrorCode.priceImportBadFile);
  return list;
}

function extractPriceList(parsed: unknown): PriceBookEntry[] | null {
  if (Array.isArray(parsed)) {
    return parsed.flatMap((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) return [];
      const record = row as Record<string, unknown>;
      const itemName = typeof record.itemName === "string" ? record.itemName : typeof record.item_name === "string" ? record.item_name : null;
      const unitCopper = typeof record.unitCopper === "number" ? record.unitCopper : typeof record.unit_copper === "number" ? record.unit_copper : null;
      if (!itemName || unitCopper == null) return [];
      return [{ itemName, unitCopper }];
    });
  }
  if (!parsed || typeof parsed !== "object") return null;
  const root = parsed as Record<string, unknown>;
  if (Array.isArray(root.prices)) return extractPriceList(root.prices);
  return null;
}
