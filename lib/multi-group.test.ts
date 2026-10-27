import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { ingestLoot, openDatabase } from "./db";
import { closeParty, joinParty, listParties, readParty, renameParty, startParty } from "./group";
import { parseLedgerDocument } from "./ledger-parse";

const origin = { characterFromPath: "Aldren", serverFromPath: "Estaire", characterFromFile: "Aldren" };

function tmpDb() {
  const file = path.join(os.tmpdir(), `registre-multi-${Date.now()}-${Math.random()}.sqlite`);
  return { file, db: openDatabase(file) };
}

function cleanup(file: string, db: ReturnType<typeof openDatabase>) {
  db.close();
  fs.rmSync(file, { force: true });
  fs.rmSync(`${file}-wal`, { force: true });
  fs.rmSync(`${file}-shm`, { force: true });
}

function loot(at: string) {
  return parseLedgerDocument(
    { c05: "Aldren", c01: [{ f01: "act_13", f03: [{ d04: "Objet fictif" }], f04: at, f07: "Aldren" }] },
    origin,
  ).loot;
}

describe("multi-group archives", () => {
  it("keeps a closed group readable while a new active group takes new loot", () => {
    const { file, db } = tmpDb();
    try {
      startParty(db, [{ label: "Mira" }], "  Crypte   du nord ");
      db.prepare("UPDATE parties SET started_at = ? WHERE status = 'open'").run("2026-10-22T10:00:00.000Z");
      ingestLoot(db, loot("2026-10-22T11:00:00Z"));
      const first = readParty(db).party;
      assert.ok(first);
      assert.equal(first.name, "Crypte du nord");
      closeParty(db);

      const second = startParty(db, [{ label: "Lira" }]);
      assert.ok(second.party);
      assert.equal(second.party.name, null);
      db.prepare("UPDATE parties SET started_at = ? WHERE status = 'open'").run("2026-10-22T12:00:00.000Z");
      ingestLoot(db, loot("2026-10-22T12:30:00Z"));

      const parties = listParties(db);
      assert.deepEqual(
        parties.map((row) => [row.status, row.lootCount]),
        [
          ["open", 1],
          ["closed", 1],
        ],
      );
      assert.ok(parties[1]?.closedAt);

      const archive = readParty(db, first.id);
      assert.equal(archive.party?.status, "closed");
      assert.equal(archive.lines.length, 1);
      assert.equal(archive.lines[0]?.lootedAt.startsWith("2026-10-22T11:00"), true);

      // Mutations still only target the active group.
      const joined = joinParty({ label: "Nox" }, db);
      assert.equal(joined.party?.id, second.party.id);
      assert.equal(readParty(db, first.id).party?.presences.length, 1);

      const renamed = renameParty(first.id, "Crypte (fini)", db);
      assert.equal(renamed.party?.id, first.id);
      assert.equal(renamed.party?.name, "Crypte (fini)");
      assert.equal(renameParty(first.id, "   ", db).party?.name, null);

      assert.throws(() => readParty(db, "nope"), /group\.missing/);
    } finally {
      cleanup(file, db);
    }
  });
});
