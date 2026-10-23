import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  dropHiddenPlayers,
  ingestLoot,
  ingestSales,
  openDatabase,
  rememberCharacter,
  setSetting,
  upsertPrice,
} from "./db";
import { socialLootToKeep, syncCharactersFromWatch } from "./scan";
import { parseLedgerDocument } from "./ledger-parse";
import { COPPER_PER_GOLD, COPPER_PER_PLATINUM, COPPER_PER_SILVER, coinsToCopper, copperToCoins, formatCoins } from "./money";

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

describe("coins", () => {
  it("uses the 100 to 1 ladder", () => {
    assert.equal(COPPER_PER_SILVER, 100);
    assert.equal(COPPER_PER_GOLD, 10_000);
    assert.equal(COPPER_PER_PLATINUM, 1_000_000);
    assert.equal(coinsToCopper({ platinum: 1, gold: 2, silver: 3, copper: 4 }), 1_020_304);
    assert.deepEqual(copperToCoins(1_020_304), { platinum: 1, gold: 2, silver: 3, copper: 4 });
    assert.equal(formatCoins(250), "2 silver 50 copper");
    assert.equal(formatCoins(250, "fr"), "2 argent 50 cuivre");
    assert.equal(formatCoins(250, "es"), "2 plata 50 cobre");
  });
});

describe("ingest", () => {
  it("copies the cours onto loot already recorded for that item", () => {
    const file = path.join(os.tmpdir(), `registre-${Date.now()}-${Math.random()}.sqlite`);
    const db = openDatabase(file);
    try {
      const first = ingestLoot(db, loot("Objet fictif", "2026-09-23T18:04:00Z"));
      assert.equal(first.added, 1);
      const before = db.prepare("SELECT unit_copper FROM loot_entries").get() as { unit_copper: number | null };
      assert.equal(before.unit_copper, null);

      upsertPrice(db, "Objet fictif", 250);
      const second = ingestLoot(db, loot("Autre objet fictif", "2026-09-23T18:10:00Z"));
      assert.equal(second.added, 1);
      const priced = ingestLoot(db, loot("objet fictif", "2026-09-23T18:12:00Z"));
      assert.equal(priced.added, 1);

      const afterFirstPrice = db
        .prepare("SELECT looted_at, unit_copper FROM loot_entries ORDER BY looted_at")
        .all() as Array<{ looted_at: string; unit_copper: number | null }>;
      assert.deepEqual(
        afterFirstPrice.map((row) => row.unit_copper),
        [250, null, null],
      );

      upsertPrice(db, "Objet fictif", 900);
      const rows = db
        .prepare("SELECT looted_at, unit_copper FROM loot_entries ORDER BY looted_at")
        .all() as Array<{ looted_at: string; unit_copper: number | null }>;
      assert.deepEqual(
        rows.map((row) => row.unit_copper),
        [900, null, 900],
      );

      const again = ingestLoot(db, loot("Objet fictif", "2026-09-23T18:04:00Z"));
      assert.equal(again.added, 0);
      assert.equal(again.duplicate, 1);

      const key = db.prepare("SELECT dedupe_key FROM loot_entries WHERE looted_at = ?").get("2026-09-23T18:04:00Z") as {
        dedupe_key: string;
      };
      db.prepare("INSERT INTO suppressed_loot (dedupe_key, suppressed_at) VALUES (?, ?)").run(
        key.dedupe_key,
        new Date().toISOString(),
      );
      db.prepare("DELETE FROM loot_entries WHERE dedupe_key = ?").run(key.dedupe_key);
      const blocked = ingestLoot(db, loot("Objet fictif", "2026-09-23T18:04:00Z"));
      assert.equal(blocked.suppressed, 1);
      assert.equal(blocked.added, 0);
    } finally {
      db.close();
      fs.rmSync(file, { force: true });
      fs.rmSync(`${file}-wal`, { force: true });
      fs.rmSync(`${file}-shm`, { force: true });
    }
  });

  it("stores a vendor sale outside the loot pot and ignores the price book", () => {
    const file = path.join(os.tmpdir(), `registre-${Date.now()}-${Math.random()}.sqlite`);
    const db = openDatabase(file);
    try {
      const price = Buffer.from("0 platinum 0 gold 1 silver 50 copper", "utf8").toString("base64");
      const report = parseLedgerDocument(
        {
          c05: "Aldren",
          c01: [
            {
              f01: "act_24",
              f03: JSON.stringify({ d01: 2, d03: price, d04: "Objet fictif" }),
              f04: "2026-10-22T17:19:19+02:00",
              f07: "Aldren",
            },
            {
              f01: "act_13",
              f03: [{ d04: "Butin fictif" }],
              f04: "2026-10-22T17:20:00+02:00",
              f07: "Aldren",
            },
          ],
        },
        origin,
      );
      upsertPrice(db, "Objet fictif", 999);
      assert.equal(ingestLoot(db, report.loot).added, 1);
      assert.equal(ingestSales(db, report.sales).added, 1);
      const again = ingestSales(db, report.sales);
      assert.equal(again.added, 0);
      assert.equal(again.duplicate, 1);

      const lootRows = db.prepare("SELECT item_name, unit_copper FROM loot_entries").all() as Array<{
        item_name: string;
        unit_copper: number | null;
      }>;
      assert.equal(lootRows.length, 1);
      assert.equal(lootRows[0].item_name, "Butin fictif");
      assert.equal(lootRows[0].unit_copper, null);
      const sale = db.prepare("SELECT item_name, quantity, copper FROM sales").get() as {
        item_name: string;
        quantity: number | bigint;
        copper: number | bigint | null;
      };
      assert.equal(sale.item_name, "Objet fictif");
      assert.equal(Number(sale.quantity), 2);
      assert.equal(Number(sale.copper), 150);
      const open = db.prepare("SELECT COUNT(*) AS n FROM parties").get() as { n: number | bigint };
      assert.equal(Number(open.n), 0);
    } finally {
      db.close();
      fs.rmSync(file, { force: true });
      fs.rmSync(`${file}-wal`, { force: true });
      fs.rmSync(`${file}-shm`, { force: true });
    }
  });

  it("records a character named by a ledger file without creating loot", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "registre-ledger-"));
    const file = path.join(os.tmpdir(), `registre-${Date.now()}-${Math.random()}.sqlite`);
    const ledger = path.join(dir, "Estaire", "Mira", "Ledger");
    fs.mkdirSync(ledger, { recursive: true });
    fs.writeFileSync(path.join(ledger, "Mira_Character_2026-09-23.json"), "{}\n");
    const db = openDatabase(file);
    try {
      setSetting(db, "watch_path", dir);
      syncCharactersFromWatch(db);
      const people = db.prepare("SELECT name, server_name FROM people").all() as Array<{
        name: string;
        server_name: string | null;
      }>;
      assert.equal(people.length, 1);
      assert.equal(people[0].name, "Mira");
      assert.equal(people[0].server_name, "Estaire");
      const lootCount = db.prepare("SELECT COUNT(*) AS n FROM loot_entries").get() as { n: number };
      assert.equal(Number(lootCount.n), 0);
      const flagged = db.prepare("SELECT on_machine FROM people").get() as { on_machine: number };
      assert.equal(Number(flagged.on_machine), 1);
      rememberCharacter(db, "Quelqu'un", "Estaire", false);
      dropHiddenPlayers(db);
      const left = db.prepare("SELECT name FROM people").all() as Array<{ name: string }>;
      assert.deepEqual(left.map((row) => row.name), ["Mira"]);
      const kept = socialLootToKeep(
        [
          { ...loot("Objet fictif", "2026-09-23T18:04:00Z")[0], characterName: "Mira" },
          { ...loot("Autre objet fictif", "2026-09-23T18:05:00Z")[0], characterName: "Quelqu'un" },
        ],
        new Set(["mira"]),
        false,
      );
      assert.equal(kept.length, 1);
      assert.equal(kept[0].characterName, "Mira");
      const noLocalDouble = socialLootToKeep(
        [
          { ...loot("Médaille", "2026-09-23T18:06:00Z")[0], characterName: "Mira" },
          { ...loot("Médaille", "2026-09-23T18:07:00Z")[0], characterName: "Aldren" },
        ],
        new Set(["mira", "aldren"]),
        true,
        new Set(["mira"]),
      );
      assert.equal(noLocalDouble.length, 1);
      assert.equal(noLocalDouble[0].characterName, "Aldren");
    } finally {
      db.close();
      fs.rmSync(file, { force: true });
      fs.rmSync(`${file}-wal`, { force: true });
      fs.rmSync(`${file}-shm`, { force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
