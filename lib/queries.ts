import { ErrorCode } from "./codes";
import { applyBookPrice, asNumber, getDb, showEveryone, upsertPrice } from "./db";
import { syncCharactersFromWatch } from "./scan";
import { cleanText, itemKey } from "./format";
import { isValidCopper } from "./money";
import {
  adoptMissingSalePrices,
  chooseSalePrice,
  listPriceCatalog,
  noteMatchingSalePrice,
  type PriceCatalogItem,
} from "./price-catalog";

export type PersonSummary = {
  id: string;
  name: string;
  serverName: string | null;
  lineCount: number;
  itemCount: number;
  knownValueCopper: number;
  missingPriceCount: number;
  lastLootedAt: string | null;
};

export type LootLine = {
  id: string;
  itemName: string;
  quantity: number;
  lootedAt: string;
  source: string | null;
  zone: string | null;
  note: string | null;
  unitCopper: number | null;
  bookUnitCopper: number | null;
  userEdited: boolean;
};

export type { PriceCatalogItem };

type PersonRow = {
  id: string;
  name: string;
  server_name: string | null;
  line_count: number | bigint;
  item_count: number | bigint | null;
  known_value_copper: number | bigint | null;
  missing_price_count: number | bigint | null;
  last_looted_at: string | null;
};

export function listPeople(): PersonSummary[] {
  const db = getDb();
  syncCharactersFromWatch(db);
  const where = showEveryone(db)
    ? ""
    : `WHERE p.on_machine = 1
         OR EXISTS (
           SELECT 1
           FROM party_presence pp
           JOIN parties pa ON pa.id = pp.party_id AND pa.status = 'open'
           WHERE pp.person_id = p.id
              OR pp.label = p.name COLLATE NOCASE
         )`;
  const rows = db
    .prepare(
      `SELECT
         p.id,
         p.name,
         p.server_name,
         COUNT(l.id) AS line_count,
         COALESCE(SUM(l.quantity), 0) AS item_count,
         COALESCE(SUM(CASE WHEN l.unit_copper IS NOT NULL THEN l.quantity * l.unit_copper ELSE 0 END), 0) AS known_value_copper,
         COALESCE(SUM(CASE WHEN l.unit_copper IS NULL THEN 1 ELSE 0 END), 0) AS missing_price_count,
         MAX(CASE WHEN l.looted_at = '' THEN NULL ELSE l.looted_at END) AS last_looted_at
       FROM people p
       LEFT JOIN loot_entries l ON l.person_id = p.id
       ${where}
       GROUP BY p.id
       ORDER BY p.name COLLATE NOCASE`,
    )
    .all() as PersonRow[];

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    serverName: row.server_name,
    lineCount: asNumber(row.line_count),
    itemCount: asNumber(row.item_count),
    knownValueCopper: asNumber(row.known_value_copper),
    missingPriceCount: asNumber(row.missing_price_count),
    lastLootedAt: row.last_looted_at,
  }));
}

export function getPersonLoot(id: string, query: string) {
  const db = getDb();
  const person = db.prepare("SELECT id, name, server_name FROM people WHERE id = ?").get(id) as
    | { id: string; name: string; server_name: string | null }
    | undefined;
  if (!person) return null;

  const totals = db
    .prepare(
      `SELECT
         COUNT(*) AS line_count,
         COALESCE(SUM(quantity), 0) AS item_count,
         COALESCE(SUM(CASE WHEN unit_copper IS NOT NULL THEN quantity * unit_copper ELSE 0 END), 0) AS known_value_copper,
         COALESCE(SUM(CASE WHEN unit_copper IS NULL THEN 1 ELSE 0 END), 0) AS missing_price_count
       FROM loot_entries
       WHERE person_id = ?`,
    )
    .get(id) as {
    line_count: number | bigint;
    item_count: number | bigint | null;
    known_value_copper: number | bigint | null;
    missing_price_count: number | bigint | null;
  };

  const needle = query.trim().toLocaleLowerCase("fr");
  const rows = db
    .prepare(
      `SELECT
         l.id, l.item_name, l.quantity, l.looted_at, l.source, l.zone, l.note,
         l.unit_copper, l.user_edited, b.unit_copper AS book_unit_copper
       FROM loot_entries l
       LEFT JOIN price_book b ON b.item_key = l.item_key
       WHERE l.person_id = ?
       ORDER BY CASE WHEN l.looted_at = '' THEN 1 ELSE 0 END, l.looted_at DESC, l.created_at DESC`,
    )
    .all(id) as Array<{
    id: string;
    item_name: string;
    quantity: number;
    looted_at: string;
    source: string | null;
    zone: string | null;
    note: string | null;
    unit_copper: number | null;
    user_edited: number;
    book_unit_copper: number | null;
  }>;

  const entries: LootLine[] = rows
    .filter((row) => !needle || row.item_name.toLocaleLowerCase("fr").includes(needle))
    .map((row) => ({
      id: row.id,
      itemName: row.item_name,
      quantity: row.quantity,
      lootedAt: row.looted_at,
      source: row.source,
      zone: row.zone,
      note: row.note,
      unitCopper: row.unit_copper,
      bookUnitCopper: row.book_unit_copper,
      userEdited: row.user_edited === 1,
    }));

  return {
    person: { id: person.id, name: person.name, serverName: person.server_name },
    totals: {
      lineCount: asNumber(totals.line_count),
      itemCount: asNumber(totals.item_count),
      knownValueCopper: asNumber(totals.known_value_copper),
      missingPriceCount: asNumber(totals.missing_price_count),
    },
    entries,
  };
}

export function renamePerson(id: string, name: string) {
  const cleaned = cleanText(name, 80);
  if (!cleaned) throw new Error(ErrorCode.personNeedName);
  const info = getDb().prepare("UPDATE people SET name = ?, updated_at = ? WHERE id = ?").run(
    cleaned,
    new Date().toISOString(),
    id,
  );
  if (Number(info.changes) === 0) throw new Error(ErrorCode.personMissing);
}

export function removePerson(id: string) {
  const db = getDb();
  const keys = db.prepare("SELECT dedupe_key FROM loot_entries WHERE person_id = ?").all(id) as Array<{
    dedupe_key: string;
  }>;
  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    const suppress = db.prepare(
      `INSERT INTO suppressed_loot (dedupe_key, suppressed_at) VALUES (?, ?)
       ON CONFLICT(dedupe_key) DO NOTHING`,
    );
    for (const row of keys) suppress.run(row.dedupe_key, now);
    db.prepare("DELETE FROM people WHERE id = ?").run(id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function updateLootLine(
  id: string,
  input: {
    itemName?: unknown;
    quantity?: unknown;
    source?: unknown;
    zone?: unknown;
    note?: unknown;
    unitCopper?: unknown;
    priceKnown?: unknown;
    saveToBook?: unknown;
  },
) {
  const db = getDb();
  const current = db.prepare("SELECT id, item_name FROM loot_entries WHERE id = ?").get(id) as
    | { id: string; item_name: string }
    | undefined;
  if (!current) throw new Error(ErrorCode.lootMissing);

  const itemName = cleanText(input.itemName, 120) ?? current.item_name;
  const quantity = input.quantity;
  if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > 999_999) {
    throw new Error(ErrorCode.lootBadQuantity);
  }
  const source = optionalText(input.source, 160);
  const zone = optionalText(input.zone, 160);
  const note = optionalText(input.note, 500);
  const priceKnown = input.priceKnown === true;
  let unitCopper: number | null = null;
  if (priceKnown) {
    if (!isValidCopper(input.unitCopper)) {
      throw new Error(ErrorCode.priceInvalid);
    }
    unitCopper = input.unitCopper;
  }

  db.prepare(
    `UPDATE loot_entries
     SET item_name = ?, item_key = ?, quantity = ?, source = ?, zone = ?, note = ?,
         unit_copper = ?, user_edited = 1, updated_at = ?
     WHERE id = ?`,
  ).run(itemName, itemKey(itemName), quantity, source, zone, note, unitCopper, new Date().toISOString(), id);

  if (input.saveToBook === true && unitCopper !== null) {
    upsertPrice(db, itemName, unitCopper);
  }
}

export function removeLootLine(id: string) {
  const db = getDb();
  const row = db.prepare("SELECT dedupe_key FROM loot_entries WHERE id = ?").get(id) as
    | { dedupe_key: string }
    | undefined;
  if (!row) throw new Error(ErrorCode.lootMissing);
  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO suppressed_loot (dedupe_key, suppressed_at) VALUES (?, ?)
       ON CONFLICT(dedupe_key) DO NOTHING`,
    ).run(row.dedupe_key, new Date().toISOString());
    db.prepare("DELETE FROM loot_entries WHERE id = ?").run(id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function listPrices(query: string): PriceCatalogItem[] {
  const db = getDb();
  // One-shot backfill for sales recorded before auto-adopt existed.
  adoptMissingSalePrices(db);
  const needle = query.trim().toLocaleLowerCase("fr");
  return listPriceCatalog(db).filter(
    (row) => !needle || row.itemName.toLocaleLowerCase("fr").includes(needle),
  );
}

export function createPrice(itemName: unknown, unitCopper: unknown) {
  if (!isValidCopper(unitCopper)) throw new Error(ErrorCode.priceInvalid);
  const db = getDb();
  upsertPrice(db, String(itemName ?? ""), unitCopper);
  noteMatchingSalePrice(db, String(itemName ?? ""), unitCopper);
}

export function choosePriceFromSale(itemName: unknown, choice: unknown) {
  chooseSalePrice(getDb(), itemName, choice);
}

export function updatePrice(id: string, itemName: unknown, unitCopper: unknown) {
  if (!isValidCopper(unitCopper)) throw new Error(ErrorCode.priceInvalid);
  const name = cleanText(itemName, 120);
  if (!name) throw new Error(ErrorCode.itemNeedName);
  const db = getDb();
  const key = itemKey(name);
  const current = db.prepare("SELECT item_key FROM price_book WHERE id = ?").get(id) as
    | { item_key: string }
    | undefined;
  if (!current) throw new Error(ErrorCode.priceMissing);
  const clash = db.prepare("SELECT id FROM price_book WHERE item_key = ? AND id != ?").get(key, id) as
    | { id: string }
    | undefined;
  if (clash) throw new Error(ErrorCode.priceDuplicate);
  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE price_book SET item_name = ?, item_key = ?, unit_copper = ?, updated_at = ? WHERE id = ?").run(
      name,
      key,
      unitCopper,
      now,
      id,
    );
    applyBookPrice(db, current.item_key, unitCopper);
    if (key !== current.item_key) applyBookPrice(db, key, unitCopper);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  noteMatchingSalePrice(db, name, unitCopper);
}

export function deletePrice(id: string) {
  const info = getDb().prepare("DELETE FROM price_book WHERE id = ?").run(id);
  if (Number(info.changes) === 0) throw new Error(ErrorCode.priceMissing);
}

function optionalText(value: unknown, max: number): string | null {
  if (value === null || value === undefined || value === "") return null;
  return cleanText(value, max);
}
