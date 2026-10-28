import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { ingestLoot, ingestSales, openDatabase, upsertPrice } from "./db";
import { readParty, startParty } from "./group";
import { parseLedgerDocument } from "./ledger-parse";
import { listPriceCatalog } from "./price-catalog";
import { applySharedPrices } from "./shared-prices";

const origin = { characterFromPath: "Aldren", serverFromPath: "Estaire", characterFromFile: "Aldren" };

function tmpDb() {
  const file = path.join(os.tmpdir(), `registre-shared-${Date.now()}-${Math.random()}.sqlite`);
  return { file, db: openDatabase(file) };
}

function cleanup(file: string, db: ReturnType<typeof openDatabase>) {
  db.close();
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${file}${suffix}`, { force: true });
}

function loot(at: string, item: string) {
  return parseLedgerDocument(
    { c05: "Aldren", c01: [{ f01: "act_13", f03: [{ d04: item }], f04: at, f07: "Aldren" }] },
    origin,
  ).loot;
}

describe("applySharedPrices", () => {
  it("fills missing prices at once, keeps local ones, and asks no decision", () => {
    const { file, db } = tmpDb();
    try {
      startParty(db);
      db.prepare("UPDATE parties SET started_at = ? WHERE status = 'open'").run("2026-10-22T10:00:00.000Z");
      ingestLoot(db, loot("2026-10-22T11:00:00Z", "Wolf Pelt"));
      ingestLoot(db, loot("2026-10-22T11:05:00Z", "Bone Charm"));
      ingestLoot(db, loot("2026-10-22T11:10:00Z", "Spider Silk"));
      upsertPrice(db, "Bone Charm", 120);
      // Own vendor sale: becomes the local price by itself, so the shared one must not override it.
      const sale = ingestSales(db, [
        {
          dedupeKey: "sale-1",
          characterName: "Aldren",
          serverName: "Estaire",
          itemName: "Spider Silk",
          quantity: 2,
          soldAt: "2026-10-22T12:00:00Z",
          copper: 80,
          zone: null,
        },
      ]);
      assert.equal(sale.added, 1);

      const result = applySharedPrices(
        [
          { itemName: "Wolf Pelt", unitCopper: 45 },
          { itemName: "Bone Charm", unitCopper: 999 },
          { itemName: "Spider Silk", unitCopper: 35 },
        ],
        null,
        db,
      );
      assert.equal(result.added, 1);
      assert.equal(result.skippedExisting, 2);

      // Loot already in the pot picks the new price up; local prices are untouched.
      const prices = new Map(readParty(db).lines.map((line) => [line.itemName, line.unitCopper]));
      assert.equal(prices.get("Wolf Pelt"), 45);
      assert.equal(prices.get("Bone Charm"), 120);
      assert.equal(prices.get("Spider Silk"), 40);

      // Nothing lands in "needs a decision".
      assert.ok(listPriceCatalog(db).every((row) => !row.askReplace));
      assert.equal(listPriceCatalog(db).find((row) => row.itemName === "Wolf Pelt")?.unitCopper, 45);
    } finally {
      cleanup(file, db);
    }
  });
});
