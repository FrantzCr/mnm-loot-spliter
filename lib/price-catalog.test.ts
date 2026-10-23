import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { ingestLoot, ingestSales, openDatabase, upsertPrice } from "./db";
import { itemKey } from "./format";
import { parseLedgerDocument } from "./ledger-parse";
import { chooseSalePrice, listPriceCatalog, noteMatchingSalePrice } from "./price-catalog";
import { unitPriceFromSale } from "./sale-price";

const origin = { characterFromPath: "Aldren", serverFromPath: "Estaire", characterFromFile: "Aldren" };

function loot(item: string, at: string) {
  return parseLedgerDocument(
    {
      c05: "Aldren",
      c01: [{ f01: "act_13", f03: [{ d04: item }], f04: at, f07: "Aldren" }],
    },
    origin,
  ).loot;
}

function sale(item: string, at: string, quantity: number, coins: string | null, zone?: string) {
  const detail: Record<string, unknown> = { d01: quantity, d04: item };
  if (coins) detail.d03 = Buffer.from(coins, "utf8").toString("base64");
  const event: Record<string, unknown> = {
    f01: "act_24",
    f03: JSON.stringify(detail),
    f04: at,
    f07: "Aldren",
  };
  if (zone) event.f05 = `zone_${Buffer.from(zone, "utf8").toString("base64")}`;
  return parseLedgerDocument(
    {
      c05: "Aldren",
      c01: [event],
    },
    origin,
  ).sales;
}

function tempDb() {
  const file = path.join(os.tmpdir(), `registre-${Date.now()}-${Math.random()}.sqlite`);
  const db = openDatabase(file);
  return {
    db,
    close() {
      db.close();
      fs.rmSync(file, { force: true });
      fs.rmSync(`${file}-wal`, { force: true });
      fs.rmSync(`${file}-shm`, { force: true });
    },
  };
}

describe("unit price from a sale", () => {
  it("divides only when the proceeds split into whole copper", () => {
    assert.equal(unitPriceFromSale(2, 150), 75);
    assert.equal(unitPriceFromSale(1, 250), 250);
    assert.equal(unitPriceFromSale(4, 8), 2);
    assert.equal(unitPriceFromSale(3, 100), null);
    assert.equal(unitPriceFromSale(1, null), null);
    assert.equal(unitPriceFromSale(0, 10), null);
  });
});

describe("price catalog", () => {
  it("lists loot, sales, and saved prices once, and asks before replacing a price", () => {
    const { db, close } = tempDb();
    try {
      ingestLoot(db, loot("Objet fictif", "2026-10-22T10:00:00+02:00"));
      ingestLoot(db, loot("Butin fictif", "2026-10-22T10:05:00+02:00"));
      ingestSales(db, sale("objet fictif", "2026-10-22T11:00:00+02:00", 2, "0 platinum 0 gold 1 silver 50 copper"));
      ingestSales(db, sale("Pile fictive", "2026-10-22T11:05:00+02:00", 3, "0 platinum 0 gold 0 silver 1 copper"));
      ingestSales(db, sale("Sans montant", "2026-10-22T11:06:00+02:00", 1, null));
      upsertPrice(db, "Manuel fictif", 10);

      const first = listPriceCatalog(db);
      assert.deepEqual(
        first.map((row) => row.itemName),
        ["Butin fictif", "Pile fictive", "Sans montant", "Manuel fictif", "objet fictif"],
      );
      assert.equal(first.filter((row) => row.itemKey === itemKey("Objet fictif")).length, 1);

      const objet = first.find((row) => row.itemKey === itemKey("Objet fictif"));
      assert.ok(objet);
      // First clean vendor sale fills the book automatically.
      assert.equal(objet.unitCopper, 75);
      assert.equal(objet.saleUnitCopper, 75);
      assert.equal(objet.askReplace, false);

      const pile = first.find((row) => row.itemName === "Pile fictive");
      assert.ok(pile);
      assert.equal(pile.saleQuantity, 3);
      assert.equal(pile.saleCopper, 1);
      assert.equal(pile.saleUnitCopper, null);
      assert.equal(pile.askReplace, false);

      const missing = first.find((row) => row.itemName === "Sans montant");
      assert.ok(missing);
      assert.equal(missing.saleCopper, null);
      assert.equal(missing.saleUnitCopper, null);

      const lootOnly = first.find((row) => row.itemName === "Butin fictif");
      assert.ok(lootOnly);
      assert.equal(lootOnly.saleQuantity, null);
      assert.equal(lootOnly.unitCopper, null);

      const outside = db.prepare("SELECT item_name FROM loot_entries").all() as Array<{ item_name: string }>;
      assert.deepEqual(
        outside.map((row) => row.item_name).sort(),
        ["Butin fictif", "Objet fictif"],
      );

      upsertPrice(db, "Objet fictif", 999);
      const edited = listPriceCatalog(db).find((row) => row.itemKey === itemKey("Objet fictif"));
      assert.ok(edited);
      assert.equal(edited.unitCopper, 999);
      assert.equal(edited.saleUnitCopper, 75);
      // Same sale was already auto-accepted — no decision until a newer sale differs.
      assert.equal(edited.askReplace, false);
      const pricedLoot = db.prepare("SELECT unit_copper FROM loot_entries WHERE item_key = ?").get(itemKey("Objet fictif")) as {
        unit_copper: number | bigint;
      };
      assert.equal(Number(pricedLoot.unit_copper), 999);

      ingestSales(db, sale("Objet fictif", "2026-10-22T12:00:00+02:00", 1, "0 platinum 0 gold 2 silver 0 copper"));
      const again = listPriceCatalog(db).find((row) => row.itemKey === itemKey("Objet fictif"));
      assert.ok(again);
      assert.equal(again.saleUnitCopper, 200);
      assert.equal(again.askReplace, true);

      chooseSalePrice(db, "Objet fictif", "keep");
      const kept = listPriceCatalog(db).find((row) => row.itemKey === itemKey("Objet fictif"));
      assert.ok(kept);
      assert.equal(kept.unitCopper, 999);
      assert.equal(kept.askReplace, false);
      const still = db.prepare("SELECT unit_copper FROM loot_entries WHERE item_key = ?").get(itemKey("Objet fictif")) as {
        unit_copper: number | bigint;
      };
      assert.equal(Number(still.unit_copper), 999);

      chooseSalePrice(db, "Objet fictif", "replace");
      const replaced = listPriceCatalog(db).find((row) => row.itemKey === itemKey("Objet fictif"));
      assert.ok(replaced);
      assert.equal(replaced.unitCopper, 200);
      assert.equal(replaced.askReplace, false);
      const book = db.prepare("SELECT unit_copper FROM price_book WHERE item_key = ?").get(itemKey("Objet fictif")) as {
        unit_copper: number | bigint;
      };
      assert.equal(Number(book.unit_copper), 200);
      const applied = db.prepare("SELECT unit_copper FROM loot_entries WHERE item_key = ?").get(itemKey("Objet fictif")) as {
        unit_copper: number | bigint;
      };
      assert.equal(Number(applied.unit_copper), 200);

      ingestSales(db, sale("Objet fictif", "2026-10-22T13:00:00+02:00", 1, "0 platinum 0 gold 0 silver 50 copper"));
      const third = listPriceCatalog(db).find((row) => row.itemKey === itemKey("Objet fictif"));
      assert.ok(third);
      assert.equal(third.saleUnitCopper, 50);
      assert.equal(third.unitCopper, 200);
      assert.equal(third.askReplace, true);

      assert.throws(() => chooseSalePrice(db, "Pile fictive", "replace"), /price\.invalid/);
      const pileBook = db.prepare("SELECT id FROM price_book WHERE item_key = ?").get(itemKey("Pile fictive"));
      assert.equal(pileBook, undefined);
    } finally {
      close();
    }
  });

  it("remembers an accepted sale price when the saved price later changes", () => {
    const { db, close } = tempDb();
    try {
      ingestSales(db, sale("Objet fictif", "2026-10-22T11:00:00+02:00", 1, "0 platinum 0 gold 0 silver 75 copper"));
      upsertPrice(db, "Objet fictif", 75);
      noteMatchingSalePrice(db, "Objet fictif", 75);
      upsertPrice(db, "Objet fictif", 10);
      const row = listPriceCatalog(db).find((item) => item.itemKey === itemKey("Objet fictif"));
      assert.ok(row);
      assert.equal(row.unitCopper, 10);
      assert.equal(row.saleUnitCopper, 75);
      assert.equal(row.askReplace, false);
    } finally {
      close();
    }
  });

  it("uses the latest sale, not an older one with an empty time", () => {
    const { db, close } = tempDb();
    try {
      ingestSales(db, sale("Objet fictif", "", 1, "0 platinum 0 gold 9 silver 99 copper"));
      ingestSales(db, sale("Objet fictif", "2026-10-22T11:00:00+02:00", 1, "0 platinum 0 gold 0 silver 10 copper"));
      const row = listPriceCatalog(db)[0];
      assert.equal(row.saleUnitCopper, 10);
    } finally {
      close();
    }
  });

  it("fills zone on duplicate sale rows and asks only when a later sale differs", () => {
    const { db, close } = tempDb();
    try {
      ingestSales(
        db,
        sale("Objet fictif", "2026-10-22T11:00:00+02:00", 1, "0 platinum 0 gold 1 silver 50 copper", "crique-ouest"),
      );
      const stored = db.prepare("SELECT zone FROM sales").get() as { zone: string };
      assert.equal(stored.zone, "crique-ouest");
      db.prepare("UPDATE sales SET zone = NULL").run();
      const again = ingestSales(
        db,
        sale("Objet fictif", "2026-10-22T11:00:00+02:00", 1, "0 platinum 0 gold 1 silver 50 copper", "crique-ouest"),
      );
      assert.equal(again.added, 0);
      assert.equal(again.duplicate, 1);
      const filled = db.prepare("SELECT zone FROM sales").get() as { zone: string };
      assert.equal(filled.zone, "crique-ouest");

      const adopted = listPriceCatalog(db).find((item) => item.itemKey === itemKey("Objet fictif"));
      assert.ok(adopted);
      assert.equal(adopted.unitCopper, 150);
      assert.equal(adopted.savedZone, "crique-ouest");
      assert.equal(adopted.askReplace, false);

      ingestSales(
        db,
        sale("Objet fictif", "2026-10-22T12:00:00+02:00", 1, "0 platinum 0 gold 2 silver 50 copper", "crique-est"),
      );
      const conflict = listPriceCatalog(db).find((item) => item.itemKey === itemKey("Objet fictif"));
      assert.ok(conflict);
      assert.equal(conflict.unitCopper, 150);
      assert.equal(conflict.saleUnitCopper, 250);
      assert.equal(conflict.saleZone, "crique-est");
      assert.equal(conflict.askReplace, true);
    } finally {
      close();
    }
  });

  it("keeps the saved price when the user declines a newer sale", () => {
    const { db, close } = tempDb();
    try {
      ingestLoot(db, loot("Objet fictif", "2026-10-22T10:00:00+02:00"));
      ingestSales(
        db,
        sale("Objet fictif", "2026-10-22T11:00:00+02:00", 1, "0 platinum 0 gold 1 silver 50 copper", "crique-ouest"),
      );
      ingestSales(
        db,
        sale("Objet fictif", "2026-10-22T12:00:00+02:00", 1, "0 platinum 0 gold 2 silver 50 copper", "crique-est"),
      );
      const pending = listPriceCatalog(db).find((item) => item.itemKey === itemKey("Objet fictif"));
      assert.ok(pending);
      assert.equal(pending.unitCopper, 150);
      assert.equal(pending.saleUnitCopper, 250);
      assert.equal(pending.askReplace, true);

      chooseSalePrice(db, "Objet fictif", "keep");
      const row = listPriceCatalog(db).find((item) => item.itemKey === itemKey("Objet fictif"));
      assert.ok(row);
      assert.equal(row.unitCopper, 150);
      assert.equal(row.savedZone, "crique-ouest");
      assert.equal(row.saleUnitCopper, 250);
      assert.equal(row.askReplace, false);
      const priced = db.prepare("SELECT unit_copper FROM loot_entries WHERE item_key = ?").get(itemKey("Objet fictif")) as {
        unit_copper: number | bigint;
      };
      assert.equal(Number(priced.unit_copper), 150);

      ingestSales(
        db,
        sale("Objet fictif", "2026-10-22T13:00:00+02:00", 1, "0 platinum 0 gold 2 silver 50 copper", "crique-est"),
      );
      const resold = listPriceCatalog(db).find((item) => item.itemKey === itemKey("Objet fictif"));
      assert.ok(resold);
      assert.equal(resold.unitCopper, 150);
      assert.equal(resold.saleUnitCopper, 250);
      assert.equal(resold.askReplace, true);
    } finally {
      close();
    }
  });
});
