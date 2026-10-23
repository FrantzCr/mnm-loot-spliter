import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { openDatabase, upsertPrice } from "./db";
import { itemKey } from "./format";
import { applyMnmdbPrices, parseMnmdbDataset, weightedUnitCopper } from "./mnmdb-prices";

describe("mnmdb-prices", () => {
  it("computes a weighted unit price from observations", () => {
    assert.equal(
      weightedUnitCopper([
        { copper: 10, count: 1 },
        { copper: 20, count: 3 },
      ]),
      18,
    );
    assert.equal(weightedUnitCopper([]), null);
  });

  it("parses data.json-shaped payloads", () => {
    const parsed = parseMnmdbDataset({
      generatedAt: "2026-10-10T00:00:00.000Z",
      source: "mnm-tools",
      items: [
        { name: "Brittle Stone", prices: [{ copper: 1, count: 40 }] },
        { name: "No Price Yet", prices: [] },
        { name: "Bad", prices: [{ copper: -1, count: 2 }] },
      ],
    });
    assert.equal(parsed.items.length, 1);
    assert.equal(parsed.items[0]?.itemName, "Brittle Stone");
    assert.equal(parsed.items[0]?.unitCopper, 1);
    assert.equal(parsed.generatedAt, "2026-10-10T00:00:00.000Z");
  });

  it("fills missing book rows and never overwrites local prices", () => {
    const file = path.join(os.tmpdir(), `registre-mnmdb-${Date.now()}-${Math.random()}.sqlite`);
    try {
      const db = openDatabase(file);
      upsertPrice(db, "Local Sword", 500);
      const result = applyMnmdbPrices(
        [
          { itemName: "Local Sword", unitCopper: 1 },
          { itemName: "Community Ore", unitCopper: 12 },
        ],
        { generatedAt: "2026-10-10T00:00:00.000Z", source: "mnm-tools" },
        db,
      );
      assert.equal(result.added, 1);
      assert.equal(result.skippedExisting, 1);
      const local = db.prepare("SELECT unit_copper FROM price_book WHERE item_key = ?").get(itemKey("Local Sword")) as {
        unit_copper: number;
      };
      const ore = db.prepare("SELECT unit_copper FROM price_book WHERE item_key = ?").get(itemKey("Community Ore")) as {
        unit_copper: number;
      };
      assert.equal(Number(local.unit_copper), 500);
      assert.equal(Number(ore.unit_copper), 12);
      db.close();
    } finally {
      fs.rmSync(file, { force: true });
      for (const suffix of ["-wal", "-shm"]) {
        fs.rmSync(`${file}${suffix}`, { force: true });
      }
    }
  });
});
