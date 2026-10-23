import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { ingestLoot, ingestSales, openDatabase, upsertPrice } from "./db";
import { closeParty, joinParty, readParty, startParty } from "./group";
import { itemKey } from "./format";
import { COIN_LOOT_ITEM_NAME, parseLedgerDocument } from "./ledger-parse";
import {
  aggregateSellableLoot,
  dismissAllPendingResale,
  dismissRecentPlayer,
  listPendingResale,
  listRecentPlayers,
  reducePendingQuantity,
} from "./pending-resale";

const origin = { characterFromPath: "Aldren", serverFromPath: "Estaire", characterFromFile: "Aldren" };

function tmpDb() {
  const file = path.join(os.tmpdir(), `registre-pending-${Date.now()}-${Math.random()}.sqlite`);
  return { file, db: openDatabase(file) };
}

function cleanup(file: string, db: ReturnType<typeof openDatabase>) {
  db.close();
  fs.rmSync(file, { force: true });
  fs.rmSync(`${file}-wal`, { force: true });
  fs.rmSync(`${file}-shm`, { force: true });
}

describe("aggregateSellableLoot", () => {
  it("stacks the same item and skips corpse coins", () => {
    const rows = aggregateSellableLoot([
      { itemName: "Raw Rat Meat", quantity: 2, unitCopper: 5 },
      { itemName: "Raw Rat Meat", quantity: 3, unitCopper: 5 },
      { itemName: COIN_LOOT_ITEM_NAME, quantity: 1, unitCopper: 49 },
      { itemName: "Broken Sword", quantity: 1, unitCopper: null },
    ]);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], {
      itemKey: itemKey("Raw Rat Meat"),
      itemName: "Raw Rat Meat",
      quantity: 5,
      unitCopper: 5,
    });
    assert.equal(rows[1]?.itemName, "Broken Sword");
    assert.equal(rows[1]?.unitCopper, null);
  });
});

describe("reducePendingQuantity", () => {
  it("clears when the sale covers the queue", () => {
    assert.deepEqual(reducePendingQuantity(3, 3), { nextQuantity: 0, consumed: 3 });
    assert.deepEqual(reducePendingQuantity(2, 5), { nextQuantity: 0, consumed: 2 });
  });

  it("shrinks a partial sale", () => {
    assert.deepEqual(reducePendingQuantity(5, 2), { nextQuantity: 3, consumed: 2 });
  });
});

describe("closeParty recap", () => {
  it("enqueues group loot for resale and remembers players", () => {
    const { file, db } = tmpDb();
    try {
      startParty(db, [{ label: "Place" }]);
      db.prepare("UPDATE parties SET started_at = ? WHERE status = 'open'").run("2026-10-22T10:00:00.000Z");
      const events = parseLedgerDocument(
        {
          c05: "Aldren",
          c01: [
            { f01: "act_13", f03: [{ d04: "Objet fictif" }], f04: "2026-10-22T11:00:00Z", f07: "Aldren" },
            { f01: "act_13", f03: [{ d04: "Objet fictif" }], f04: "2026-10-22T11:01:00Z", f07: "Aldren" },
            { f01: "act_13", f03: [{ d04: "Sans cours" }], f04: "2026-10-22T11:02:00Z", f07: "Aldren" },
          ],
        },
        origin,
      ).loot;
      assert.equal(ingestLoot(db, events).added, 3);
      upsertPrice(db, "Objet fictif", 250);
      const aldren = db.prepare("SELECT id FROM people").get() as { id: string };
      joinParty({ personId: aldren.id }, db, "2026-10-22T10:00:00.000Z");
      joinParty({ label: "Mira" }, db, "2026-10-22T10:00:00.000Z");

      closeParty(db);
      assert.equal(readParty(db).party, null);

      const pending = listPendingResale(db);
      assert.equal(pending.length, 2);
      const priced = pending.find((row) => row.itemKey === itemKey("Objet fictif"));
      assert.ok(priced);
      assert.equal(priced.quantity, 2);
      assert.equal(priced.unitCopper, 250);
      assert.equal(priced.lineCopper, 500);
      const unpriced = pending.find((row) => row.itemKey === itemKey("Sans cours"));
      assert.ok(unpriced);
      assert.equal(unpriced.unitCopper, null);

      const players = listRecentPlayers(db);
      const names = players.map((row) => row.name).sort();
      assert.deepEqual(names, ["Aldren", "Mira", "Place"]);

      dismissRecentPlayer("Mira", null, db);
      assert.deepEqual(
        listRecentPlayers(db)
          .map((row) => row.name)
          .sort(),
        ["Aldren", "Place"],
      );
    } finally {
      cleanup(file, db);
    }
  });

  it("dismissAllPendingResale clears the whole queue", () => {
    const { file, db } = tmpDb();
    try {
      startParty(db, [{ label: "Aldren" }]);
      db.prepare("UPDATE parties SET started_at = ? WHERE status = 'open'").run("2026-10-22T10:00:00.000Z");
      const loot = parseLedgerDocument(
        {
          c05: "Aldren",
          c01: [
            { f01: "act_13", f03: [{ d04: "Objet fictif" }], f04: "2026-10-22T11:00:00Z", f07: "Aldren" },
            { f01: "act_13", f03: [{ d04: "Sans cours" }], f04: "2026-10-22T11:02:00Z", f07: "Aldren" },
          ],
        },
        origin,
      ).loot;
      assert.equal(ingestLoot(db, loot).added, 2);
      upsertPrice(db, "Objet fictif", 100);
      closeParty(db);
      assert.equal(listPendingResale(db).length, 2);
      dismissAllPendingResale(db);
      assert.equal(listPendingResale(db).length, 0);
    } finally {
      cleanup(file, db);
    }
  });

  it("clears pending qty when a matching vendor sale is ingested", () => {
    const { file, db } = tmpDb();
    try {
      startParty(db, [{ label: "Aldren" }]);
      db.prepare("UPDATE parties SET started_at = ? WHERE status = 'open'").run("2026-10-22T10:00:00.000Z");
      const loot = parseLedgerDocument(
        {
          c05: "Aldren",
          c01: [
            { f01: "act_13", f03: [{ d04: "Objet fictif" }], f04: "2026-10-22T11:00:00Z", f07: "Aldren" },
            { f01: "act_13", f03: [{ d04: "Objet fictif" }], f04: "2026-10-22T11:01:00Z", f07: "Aldren" },
            { f01: "act_13", f03: [{ d04: "Objet fictif" }], f04: "2026-10-22T11:02:00Z", f07: "Aldren" },
          ],
        },
        origin,
      ).loot;
      assert.equal(ingestLoot(db, loot).added, 3);
      upsertPrice(db, "Objet fictif", 100);
      closeParty(db);
      assert.equal(listPendingResale(db)[0]?.quantity, 3);

      const partial = parseLedgerDocument(
        {
          c05: "Aldren",
          c01: [
            {
              f01: "act_24",
              f03: JSON.stringify({ d01: 2, d04: "Objet fictif" }),
              f04: "2026-10-22T12:00:00Z",
              f07: "Aldren",
            },
          ],
        },
        origin,
      ).sales;
      assert.equal(ingestSales(db, partial).added, 1);
      assert.equal(listPendingResale(db)[0]?.quantity, 1);

      const rest = parseLedgerDocument(
        {
          c05: "Aldren",
          c01: [
            {
              f01: "act_24",
              f03: JSON.stringify({ d01: 1, d04: "Objet fictif" }),
              f04: "2026-10-22T12:05:00Z",
              f07: "Aldren",
            },
          ],
        },
        origin,
      ).sales;
      assert.equal(ingestSales(db, rest).added, 1);
      assert.equal(listPendingResale(db).length, 0);
    } finally {
      cleanup(file, db);
    }
  });
});
