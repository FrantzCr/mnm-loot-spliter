import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { COIN_LOOT_ITEM_NAME } from "./ledger-parse";
import { sortLootForDisplay, stackLootLines, stackLootLinesAcrossPeople } from "./stack-loot";
import type { PotLine } from "./split";

function line(partial: Partial<PotLine> & Pick<PotLine, "id" | "itemName" | "personId">): PotLine {
  return {
    quantity: 1,
    unitCopper: null,
    lootedAt: "2026-10-22T12:00:00.000Z",
    personName: "Zaniel",
    ...partial,
  };
}

describe("stackLootLines", () => {
  it("merges corpse coin pickups for the same holder and sums copper", () => {
    const rows = stackLootLines([
      line({ id: "a", itemName: COIN_LOOT_ITEM_NAME, personId: "p1", unitCopper: 70 }),
      line({ id: "b", itemName: "Bone Chips", personId: "p1", unitCopper: 1 }),
      line({ id: "c", itemName: COIN_LOOT_ITEM_NAME, personId: "p1", unitCopper: 78 }),
      line({ id: "d", itemName: COIN_LOOT_ITEM_NAME, personId: "p1", unitCopper: 67 }),
    ]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.itemName, COIN_LOOT_ITEM_NAME);
    assert.equal(rows[0]?.quantity, 1);
    assert.equal(rows[0]?.unitCopper, 215);
    assert.equal(rows[0]?.id, "a");
    assert.equal(rows[1]?.itemName, "Bone Chips");
  });

  it("keeps corpse coins separate per holder", () => {
    const rows = stackLootLines([
      line({ id: "a", itemName: COIN_LOOT_ITEM_NAME, personId: "p1", personName: "Zaniel", unitCopper: 70 }),
      line({ id: "b", itemName: COIN_LOOT_ITEM_NAME, personId: "p2", personName: "Kayle", unitCopper: 40 }),
    ]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.unitCopper, 70);
    assert.equal(rows[1]?.unitCopper, 40);
  });

  it("stacks identical item+holder+unit price by quantity", () => {
    const rows = stackLootLines([
      line({ id: "a", itemName: "Simple Medallion", personId: "p1", quantity: 1, unitCopper: 65 }),
      line({ id: "b", itemName: "Simple Medallion", personId: "p1", quantity: 1, unitCopper: 65 }),
      line({ id: "c", itemName: "Simple Medallion", personId: "p1", quantity: 1, unitCopper: 80 }),
    ]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.quantity, 2);
    assert.equal(rows[0]?.unitCopper, 65);
    assert.equal(rows[1]?.quantity, 1);
    assert.equal(rows[1]?.unitCopper, 80);
  });

  it("keeps the same item separate per holder in per-person stacking", () => {
    const rows = stackLootLines([
      line({ id: "a", itemName: "Simple Medallion", personId: "p1", personName: "Zaniel", unitCopper: 65 }),
      line({ id: "b", itemName: "Simple Medallion", personId: "p2", personName: "Kayle", unitCopper: 65 }),
    ]);
    assert.equal(rows.length, 2);
  });
});

describe("stackLootLinesAcrossPeople", () => {
  it("stacks the same item across holders when unit price matches", () => {
    const rows = stackLootLinesAcrossPeople([
      line({ id: "a", itemName: "Simple Medallion", personId: "p1", personName: "Zaniel", quantity: 2, unitCopper: 65 }),
      line({ id: "b", itemName: "Simple Medallion", personId: "p2", personName: "Kayle", quantity: 3, unitCopper: 65 }),
      line({ id: "c", itemName: "Simple Medallion", personId: "p3", personName: "Oria", quantity: 1, unitCopper: 80 }),
    ]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.quantity, 5);
    assert.equal(rows[0]?.unitCopper, 65);
    assert.equal(rows[0]?.personName, "Zaniel, Kayle");
    assert.equal(rows[1]?.quantity, 1);
    assert.equal(rows[1]?.unitCopper, 80);
  });

  it("sums corpse coins across holders into one row", () => {
    const rows = stackLootLinesAcrossPeople([
      line({ id: "a", itemName: COIN_LOOT_ITEM_NAME, personId: "p1", personName: "Zaniel", unitCopper: 70 }),
      line({ id: "b", itemName: COIN_LOOT_ITEM_NAME, personId: "p2", personName: "Kayle", unitCopper: 40 }),
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.unitCopper, 110);
    assert.equal(rows[0]?.personName, "Zaniel, Kayle");
  });
});

describe("sortLootForDisplay", () => {
  const rows = [
    line({ id: "old", itemName: "Wool Scraps", personId: "p1", unitCopper: 3, lootedAt: "2026-10-22T10:00:00Z" }),
    line({ id: "coins", itemName: COIN_LOOT_ITEM_NAME, personId: "p1", unitCopper: 400, lootedAt: "2026-10-22T09:00:00Z" }),
    line({ id: "new", itemName: "Cheese", personId: "p1", unitCopper: 4, quantity: 3, lootedAt: "2026-10-22T12:00:00Z" }),
    line({ id: "unpriced", itemName: "Rusty Spear", personId: "p1", lootedAt: "2026-10-22T11:00:00Z" }),
  ];

  it("keeps coins first, then newest pickup first", () => {
    assert.deepEqual(sortLootForDisplay(rows, "recent").map((row) => row.id), ["coins", "new", "unpriced", "old"]);
  });

  it("keeps coins first, then cheapest line value, unpriced last", () => {
    assert.deepEqual(sortLootForDisplay(rows, "value").map((row) => row.id), ["coins", "old", "new", "unpriced"]);
  });

  it("dates a stacked row by its latest pickup", () => {
    const stacked = stackLootLinesAcrossPeople([
      line({ id: "a", itemName: "Cheese", personId: "p1", unitCopper: 4, lootedAt: "2026-10-22T10:00:00Z" }),
      line({ id: "b", itemName: "Cheese", personId: "p2", unitCopper: 4, lootedAt: "2026-10-22T13:00:00Z" }),
    ]);
    assert.equal(stacked[0]?.lootedAt, "2026-10-22T13:00:00Z");
  });
});
