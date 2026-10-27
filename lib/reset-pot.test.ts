import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { ingestLoot, openDatabase, upsertPrice } from "./db";
import { joinParty, readParty, resetPot, settlePartyEveryone, startParty } from "./group";
import { parseLedgerDocument } from "./ledger-parse";

const origin = { characterFromPath: "Aldren", serverFromPath: "Estaire", characterFromFile: "Aldren" };

function tmpDb() {
  const file = path.join(os.tmpdir(), `registre-reset-${Date.now()}-${Math.random()}.sqlite`);
  return { file, db: openDatabase(file) };
}

function cleanup(file: string, db: ReturnType<typeof openDatabase>) {
  db.close();
  fs.rmSync(file, { force: true });
  fs.rmSync(`${file}-wal`, { force: true });
  fs.rmSync(`${file}-shm`, { force: true });
}

function loot(at: string, item = "Objet fictif") {
  return parseLedgerDocument(
    { c05: "Aldren", c01: [{ f01: "act_13", f03: [{ d04: item }], f04: at, f07: "Aldren" }] },
    origin,
  ).loot;
}

describe("resetPot", () => {
  it("hides the cleared pot from loot, split and settlements while keeping the roster", () => {
    const { file, db } = tmpDb();
    try {
      startParty(db);
      db.prepare("UPDATE parties SET started_at = ? WHERE status = 'open'").run("2026-10-22T10:00:00.000Z");
      upsertPrice(db, "Objet fictif", 300);
      upsertPrice(db, "Autre objet", 100);
      assert.equal(ingestLoot(db, loot("2026-10-22T11:00:00Z")).added, 1);
      const aldren = db.prepare("SELECT id FROM people WHERE name = 'Aldren'").get() as { id: string };
      joinParty({ personId: aldren.id }, db, "2026-10-22T10:00:00.000Z");
      joinParty({ label: "Mira" }, db, "2026-10-22T10:00:00.000Z");

      const before = readParty(db);
      assert.equal(before.lines.length, 1);
      settlePartyEveryone(db);

      const after = resetPot(db, "2026-10-22T12:00:00.000Z");
      assert.ok(after.party);
      assert.equal(after.party.presences.length, 2);
      assert.ok(after.party.presences.every((presence) => presence.settledAt === null));
      assert.equal(after.lines.length, 0);
      assert.equal(after.split?.transfers.length ?? 0, 0);

      // Late log read of loot from before the reset stays hidden; new loot joins the fresh pot.
      ingestLoot(db, loot("2026-10-22T11:30:00Z", "Autre objet"));
      ingestLoot(db, loot("2026-10-22T12:30:00Z", "Autre objet"));
      const fresh = readParty(db);
      assert.equal(fresh.lines.length, 1);
      assert.equal(fresh.lines[0]?.lootedAt.startsWith("2026-10-22T12:30"), true);
      assert.equal(fresh.split?.transfers.length, 1);
      assert.equal(fresh.split?.transfers[0]?.copper, 50);

      // Ledger history is untouched.
      const total = db.prepare("SELECT COUNT(*) AS n FROM loot_entries").get() as { n: number };
      assert.equal(Number(total.n), 3);
    } finally {
      cleanup(file, db);
    }
  });
});
