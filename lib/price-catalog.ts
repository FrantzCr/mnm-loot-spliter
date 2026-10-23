import type { DatabaseSync } from "node:sqlite";

import { ErrorCode } from "./codes";
import { recordSalePriceDecision, upsertPrice } from "./db";
import { cleanText, itemKey } from "./format";
import { unitPriceFromSale } from "./sale-price";

export type PriceCatalogItem = {
  itemKey: string;
  itemName: string;
  priceId: string | null;
  unitCopper: number | null;
  updatedAt: string | null;
  saleUnitCopper: number | null;
  saleQuantity: number | null;
  saleCopper: number | null;
  saleZone: string | null;
  previousUnitCopper: number | null;
  previousZone: string | null;
  savedZone: string | null;
  askReplace: boolean;
};

type SaleOffer = {
  itemName: string;
  quantity: number | null;
  copper: number | null;
  soldAt: string;
  unitCopper: number | null;
  zone: string | null;
};

type BookRow = {
  id: string;
  item_key: string;
  item_name: string;
  unit_copper: unknown;
  updated_at: string;
};

type SaleRow = {
  item_key: string;
  item_name: string;
  quantity: unknown;
  copper: unknown;
  sold_at: string;
  zone: unknown;
};

type LootRow = {
  item_key: string;
  item_name: string;
  looted_at: string;
};

const saleOrder = "CASE WHEN sold_at = '' THEN 1 ELSE 0 END, sold_at DESC, created_at DESC, id DESC";

export function listPriceCatalog(db: DatabaseSync): PriceCatalogItem[] {
  const books = new Map<string, BookRow>();
  for (const row of db
    .prepare("SELECT id, item_key, item_name, unit_copper, updated_at FROM price_book")
    .all() as BookRow[]) {
    books.set(row.item_key, row);
  }

  const sales = new Map<string, SaleOffer[]>();
  for (const row of db
    .prepare(
      `SELECT item_key, item_name, quantity, copper, sold_at, zone
       FROM sales
       ORDER BY item_key, ${saleOrder}`,
    )
    .all() as SaleRow[]) {
    const list = sales.get(row.item_key);
    const offer = toOffer(row);
    if (list) list.push(offer);
    else sales.set(row.item_key, [offer]);
  }

  const loot = new Map<string, { itemName: string; lootedAt: string }>();
  for (const row of db
    .prepare(
      `SELECT item_key, item_name, looted_at
       FROM (
         SELECT
           item_key, item_name, looted_at,
           ROW_NUMBER() OVER (
             PARTITION BY item_key
             ORDER BY CASE WHEN looted_at = '' THEN 1 ELSE 0 END, looted_at DESC, created_at DESC, id DESC
           ) AS n
         FROM loot_entries
       ) AS ranked
       WHERE n = 1`,
    )
    .all() as LootRow[]) {
    loot.set(row.item_key, { itemName: row.item_name, lootedAt: row.looted_at });
  }

  const decisions = new Map<string, string | null>();
  for (const row of db.prepare("SELECT item_key, unit_copper, sold_at FROM sale_price_decisions").all() as Array<{
    item_key: string;
    unit_copper: unknown;
    sold_at: unknown;
  }>) {
    const copper = readInt(row.unit_copper);
    if (copper == null) continue;
    decisions.set(decisionKey(row.item_key, copper), typeof row.sold_at === "string" ? row.sold_at : null);
  }

  const keys = new Set<string>([...books.keys(), ...sales.keys(), ...loot.keys()]);
  const items: PriceCatalogItem[] = [];
  for (const key of keys) {
    const book = books.get(key);
    const history = sales.get(key) ?? [];
    const sale = history[0] ?? null;
    const picked = loot.get(key) ?? null;
    const itemName = displayName(book?.item_name ?? null, sale, picked);
    if (!itemName) continue;
    const unitCopper = book ? readInt(book.unit_copper) : null;
    const saleUnit = sale?.unitCopper ?? null;
    const earlier = history.slice(1).find((offer) => offer.unitCopper != null) ?? null;
    const showEarlier =
      unitCopper == null &&
      earlier?.unitCopper != null &&
      (earlier.unitCopper !== saleUnit || (earlier.zone != null && earlier.zone !== (sale?.zone ?? null)));
    const decided = saleUnit != null && decisionCovers(decisions.get(decisionKey(key, saleUnit)), sale?.soldAt ?? "");
    items.push({
      itemKey: key,
      itemName,
      priceId: book?.id ?? null,
      unitCopper,
      updatedAt: book?.updated_at ?? null,
      saleUnitCopper: saleUnit,
      saleQuantity: sale?.quantity ?? null,
      saleCopper: sale?.copper ?? null,
      saleZone: sale?.zone ?? null,
      previousUnitCopper: showEarlier ? earlier.unitCopper : null,
      previousZone: showEarlier ? earlier.zone : null,
      savedZone: unitCopper == null ? null : (history.find((offer) => offer.unitCopper === unitCopper)?.zone ?? null),
      askReplace: unitCopper != null && saleUnit != null && unitCopper !== saleUnit && !decided,
    });
  }

  items.sort((a, b) => {
    const priceRank = Number(a.unitCopper != null) - Number(b.unitCopper != null);
    if (priceRank !== 0) return priceRank;
    return a.itemName.localeCompare(b.itemName, "fr", { sensitivity: "base" });
  });
  return items;
}

/** Adopt the latest clean vendor unit price for every item still missing from the book. */
export function adoptMissingSalePrices(db: DatabaseSync) {
  const rows = db
    .prepare(
      `SELECT s.item_key, s.item_name, s.quantity, s.copper, s.sold_at
       FROM sales s
       WHERE NOT EXISTS (SELECT 1 FROM price_book b WHERE b.item_key = s.item_key)
       ORDER BY s.item_key, ${saleOrder}`,
    )
    .all() as SaleRow[];

  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.item_key)) continue;
    seen.add(row.item_key);
    const quantity = readInt(row.quantity);
    const copper = readInt(row.copper);
    if (quantity == null) continue;
    const unit = unitPriceFromSale(quantity, copper);
    if (unit == null) continue;
    upsertPrice(db, row.item_name, unit);
    recordSalePriceDecision(db, row.item_key, unit, "replace", row.sold_at);
  }
}

export function latestSaleOffer(db: DatabaseSync, key: string): SaleOffer | null {
  const row = db
    .prepare(
      `SELECT item_name, quantity, copper, sold_at, zone
       FROM sales
       WHERE item_key = ?
       ORDER BY ${saleOrder}
       LIMIT 1`,
    )
    .get(key) as Omit<SaleRow, "item_key"> | undefined;
  if (!row) return null;
  return toOffer({ ...row, item_key: key });
}

export function noteMatchingSalePrice(db: DatabaseSync, itemName: string, unitCopper: number) {
  const name = cleanText(itemName, 120);
  if (!name) return;
  const key = itemKey(name);
  const offer = latestSaleOffer(db, key);
  if (!offer || offer.unitCopper == null || offer.unitCopper !== unitCopper) return;
  recordSalePriceDecision(db, key, unitCopper, "replace", offer.soldAt);
}

export function chooseSalePrice(db: DatabaseSync, itemName: unknown, choice: unknown) {
  if (choice === "keepPrevious") {
    keepPreviousSalePrice(db, itemName);
    return;
  }
  if (choice !== "keep" && choice !== "replace") throw new Error(ErrorCode.priceInvalid);
  const name = cleanText(itemName, 120);
  if (!name) throw new Error(ErrorCode.itemNeedName);
  const key = itemKey(name);
  const offer = latestSaleOffer(db, key);
  if (!offer || offer.unitCopper == null) throw new Error(ErrorCode.priceInvalid);
  if (choice === "replace") upsertPrice(db, name, offer.unitCopper);
  recordSalePriceDecision(db, key, offer.unitCopper, choice, offer.soldAt);
}

function keepPreviousSalePrice(db: DatabaseSync, itemName: unknown) {
  const name = cleanText(itemName, 120);
  if (!name) throw new Error(ErrorCode.itemNeedName);
  const key = itemKey(name);
  const history = saleHistory(db, key);
  const latest = history[0];
  const earlier = history.slice(1).find((offer) => offer.unitCopper != null);
  if (!latest || latest.unitCopper == null || earlier?.unitCopper == null) throw new Error(ErrorCode.priceInvalid);
  upsertPrice(db, name, earlier.unitCopper);
  recordSalePriceDecision(db, key, latest.unitCopper, "keep", latest.soldAt);
}

function saleHistory(db: DatabaseSync, key: string): SaleOffer[] {
  const rows = db
    .prepare(
      `SELECT item_key, item_name, quantity, copper, sold_at, zone
       FROM sales
       WHERE item_key = ?
       ORDER BY ${saleOrder}`,
    )
    .all(key) as SaleRow[];
  return rows.map(toOffer);
}

function toOffer(row: SaleRow): SaleOffer {
  const quantity = readInt(row.quantity);
  const copper = readInt(row.copper);
  return {
    itemName: row.item_name,
    quantity,
    copper,
    soldAt: row.sold_at,
    unitCopper: quantity == null ? null : unitPriceFromSale(quantity, copper),
    zone: readZone(row.zone),
  };
}

function displayName(
  bookName: string | null,
  sale: SaleOffer | null,
  loot: { itemName: string; lootedAt: string } | null,
): string {
  if (bookName) return bookName;
  if (sale && loot) {
    const saleAt = sale.soldAt || "";
    const lootAt = loot.lootedAt || "";
    if (saleAt === lootAt) return sale.itemName || loot.itemName;
    return saleAt > lootAt ? sale.itemName : loot.itemName;
  }
  return sale?.itemName || loot?.itemName || "";
}

function decisionKey(key: string, unitCopper: number): string {
  return `${key}\0${unitCopper}`;
}

function decisionCovers(soldAt: string | null | undefined, saleSoldAt: string): boolean {
  if (soldAt === undefined) return false;
  if (soldAt == null) return true;
  return soldAt === saleSoldAt;
}

function readInt(value: unknown): number | null {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  return null;
}

function readZone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text || null;
}
