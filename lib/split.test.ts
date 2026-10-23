import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { ingestLoot, openDatabase, upsertPrice } from "./db";
import {
  joinParty,
  leaveParty,
  readParty,
  resetParty,
  settlePartyEveryone,
  settlePartyPresence,
  startParty,
} from "./group";
import { COIN_LOOT_ITEM_NAME, parseLedgerDocument } from "./ledger-parse";
import {
  settleEveryone,
  settlementMembers,
  settlePresence,
  splitPot,
  type PotLine,
  type PresenceWindow,
} from "./split";

const origin = { characterFromPath: "Aldren", serverFromPath: "Estaire", characterFromFile: "Aldren" };

function line(partial: Partial<PotLine> & Pick<PotLine, "id" | "itemName" | "personName">): PotLine {
  return {
    quantity: 1,
    unitCopper: null,
    lootedAt: "2026-10-22T18:00:00Z",
    personId: partial.personName,
    ...partial,
  };
}

function presence(
  id: string,
  name: string,
  joinedAt = "2026-10-22T17:00:00Z",
  leftAt: string | null = null,
): PresenceWindow {
  return { id, personId: id, name, joinedAt, leftAt };
}

describe("splitPot", () => {
  it("splits a resale total into equal shares and a settlement", () => {
    const result = splitPot(
      [
        line({ id: "a", itemName: "Épée", personName: "Aldren", personId: "aldren", unitCopper: 600 }),
        line({ id: "b", itemName: "Anneau", personName: "Mira", personId: "mira", unitCopper: 400 }),
      ],
      [
        presence("aldren", "Aldren"),
        presence("mira", "Mira"),
        { id: "p3", personId: null, name: "Part 3", joinedAt: "2026-10-22T17:00:00Z", leftAt: null },
        { id: "p4", personId: null, name: "Part 4", joinedAt: "2026-10-22T17:00:00Z", leftAt: null },
      ],
      "value",
    );
    assert.equal(result.totalCopper, 1000);
    assert.equal(result.balances.filter((row) => row.shareCopper === 250).length, 4);
    const alderen = result.balances.find((row) => row.personId === "aldren");
    const mira = result.balances.find((row) => row.personId === "mira");
    assert.equal(alderen?.balanceCopper, 350);
    assert.equal(mira?.balanceCopper, 150);
    assert.equal(
      result.transfers.reduce((sum, transfer) => sum + transfer.copper, 0),
      500,
    );
  });

  it("gives the remainder copper to the earliest seats", () => {
    const result = splitPot([], [], "value");
    assert.equal(result.totalCopper, 0);
    const withLoot = splitPot(
      [line({ id: "a", itemName: "Gemme", personName: "Aldren", personId: "aldren", unitCopper: 10 })],
      [
        presence("aldren", "Aldren"),
        { id: "p2", personId: null, name: "Part 2", joinedAt: "2026-10-22T17:00:00Z", leftAt: null },
        { id: "p3", personId: null, name: "Part 3", joinedAt: "2026-10-22T17:00:00Z", leftAt: null },
        { id: "p4", personId: null, name: "Part 4", joinedAt: "2026-10-22T17:00:00Z", leftAt: null },
      ],
      "value",
    );
    assert.deepEqual(
      withLoot.balances.slice(0, 4).map((row) => row.shareCopper),
      [3, 3, 2, 2],
    );
  });

  it("assigns items toward the lighter pile of people present", () => {
    const result = splitPot(
      [
        line({ id: "a", itemName: "Épée", personName: "Aldren", unitCopper: 100 }),
        line({ id: "b", itemName: "Anneau", personName: "Aldren", unitCopper: 40 }),
        line({ id: "c", itemName: "Cape", personName: "Mira", unitCopper: 30 }),
      ],
      [presence("aldren", "Aldren"), presence("mira", "Mira")],
      "items",
    );
    assert.deepEqual(
      result.piles.map((pile) => pile.copper),
      [100, 70],
    );
    assert.equal(result.piles[1]?.lines.map((entry) => entry.itemName).join(", "), "Anneau, Cape");
  });

  it("omits out-of-split loot holders from the settlement recap", () => {
    const result = splitPot(
      [
        line({ id: "a", itemName: "Épée", personName: "Aldren", personId: "aldren", unitCopper: 400 }),
        line({
          id: "b",
          itemName: "Anneau",
          personName: "Outsider",
          personId: "outsider",
          unitCopper: 200,
          lootedAt: "2026-10-22T18:00:00Z",
        }),
      ],
      [presence("aldren", "Aldren"), presence("mira", "Mira")],
      "value",
    );
    assert.ok(result.balances.some((row) => row.personId === "outsider"));
    assert.deepEqual(
      settlementMembers(result.balances).map((row) => row.name),
      ["Aldren", "Mira"],
    );
  });

  it("keeps corpse coins out of holds and fair share (items only); coins stay in session totals", () => {
    const result = splitPot(
      [
        line({ id: "a", itemName: "Épée", personName: "Aldren", personId: "aldren", unitCopper: 600 }),
        line({
          id: "c",
          itemName: COIN_LOOT_ITEM_NAME,
          personName: "Aldren",
          personId: "aldren",
          unitCopper: 400,
        }),
      ],
      [
        presence("aldren", "Aldren"),
        presence("mira", "Mira"),
        { id: "p3", personId: null, name: "Part 3", joinedAt: "2026-10-22T17:00:00Z", leftAt: null },
        { id: "p4", personId: null, name: "Part 4", joinedAt: "2026-10-22T17:00:00Z", leftAt: null },
      ],
      "value",
    );
    assert.equal(result.totalCopper, 1000);
    assert.equal(result.lootCopper, 600);
    assert.equal(result.splitCoinCopper, 400);
    const alderen = result.balances.find((row) => row.personId === "aldren");
    const mira = result.balances.find((row) => row.personId === "mira");
    // Sword only — never coin shares in holds.
    assert.equal(alderen?.lootedCopper, 600);
    assert.equal(mira?.lootedCopper, 0);
    assert.equal(alderen?.shareCopper, 150);
    assert.equal(alderen?.balanceCopper, 450);
  });

  it("leaves settle math unchanged when only auto-split coins are in the pot", () => {
    const result = splitPot(
      [
        line({
          id: "c",
          itemName: COIN_LOOT_ITEM_NAME,
          personName: "Zaniel",
          personId: "zaniel",
          unitCopper: 300,
        }),
      ],
      [presence("zaniel", "Zaniel"), presence("mira", "Mira"), presence("lira", "Lira")],
      "value",
    );
    assert.equal(result.totalCopper, 300);
    assert.equal(result.splitCoinCopper, 300);
    assert.equal(result.lootCopper, 0);
    for (const row of result.balances) {
      assert.equal(row.lootedCopper, 0);
      assert.equal(row.shareCopper, 0);
      assert.equal(row.balanceCopper, 0);
    }
    assert.equal(result.transfers.length, 0);
  });

  it("omits corpse coins from item piles", () => {
    const result = splitPot(
      [
        line({ id: "a", itemName: "Épée", personName: "Aldren", personId: "aldren", unitCopper: 100 }),
        line({
          id: "c",
          itemName: COIN_LOOT_ITEM_NAME,
          personName: "Aldren",
          personId: "aldren",
          unitCopper: 400,
        }),
      ],
      [presence("aldren", "Aldren"), presence("mira", "Mira")],
      "items",
    );
    assert.equal(result.piles.every((pile) => pile.lines.every((entry) => entry.itemName !== COIN_LOOT_ITEM_NAME)), true);
    assert.deepEqual(
      result.piles.map((pile) => pile.copper),
      [100, 0],
    );
  });

  it("keeps a later arrival out of earlier loot and a departure out of later loot", () => {
    const result = splitPot(
      [
        line({
          id: "a",
          itemName: "Épée",
          personName: "Aldren",
          personId: "aldren",
          unitCopper: 600,
          lootedAt: "2026-10-22T11:00:00Z",
        }),
        line({
          id: "b",
          itemName: "Anneau",
          personName: "Aldren",
          personId: "aldren",
          unitCopper: 300,
          lootedAt: "2026-10-22T13:00:00Z",
        }),
      ],
      [
        presence("aldren", "Aldren", "2026-10-22T10:00:00Z"),
        presence("mira", "Mira", "2026-10-22T10:00:00Z", "2026-10-22T12:00:00Z"),
        presence("lira", "Lira", "2026-10-22T12:00:00Z"),
      ],
      "value",
    );
    const share = (id: string) => result.balances.find((row) => row.key === id)?.shareCopper;
    assert.equal(share("aldren"), 450);
    assert.equal(share("mira"), 300);
    assert.equal(share("lira"), 150);
    assert.deepEqual(settlePresence(result.balances, "mira"), [
      {
        from: "Aldren",
        to: "Mira",
        fromPresenceId: "aldren",
        toPresenceId: "mira",
        copper: 300,
      },
    ]);

    const after = splitPot(
      [
        line({
          id: "a",
          itemName: "Épée",
          personName: "Aldren",
          personId: "aldren",
          unitCopper: 600,
          lootedAt: "2026-10-22T11:00:00Z",
        }),
        line({
          id: "b",
          itemName: "Anneau",
          personName: "Aldren",
          personId: "aldren",
          unitCopper: 300,
          lootedAt: "2026-10-22T13:00:00Z",
        }),
      ],
      [
        presence("aldren", "Aldren", "2026-10-22T10:00:00Z"),
        presence("mira", "Mira", "2026-10-22T10:00:00Z", "2026-10-22T12:00:00Z"),
        presence("lira", "Lira", "2026-10-22T12:00:00Z"),
      ],
      "value",
      [{ fromPresenceId: "aldren", toPresenceId: "mira", copper: 300 }],
    );
    assert.equal(after.balances.find((row) => row.key === "mira")?.balanceCopper, 0);
    assert.equal(after.balances.find((row) => row.key === "lira")?.balanceCopper, -150);
    assert.deepEqual(
      after.transfers.map((transfer) => transfer.toPresenceId),
      ["lira"],
    );
  });

  it("plans the same transfers as the everyone-settled preview", () => {
    const result = splitPot(
      [
        line({ id: "a", itemName: "Épée", personName: "Aldren", personId: "aldren", unitCopper: 600 }),
        line({ id: "b", itemName: "Anneau", personName: "Mira", personId: "mira", unitCopper: 200 }),
      ],
      [presence("aldren", "Aldren"), presence("mira", "Mira")],
      "value",
    );
    assert.deepEqual(settleEveryone(result.balances), result.transfers);
    assert.equal(result.transfers.length > 0, true);
    assert.equal(
      result.transfers.reduce((sum, transfer) => sum + transfer.copper, 0),
      Math.abs(result.balances.find((row) => row.key === "aldren")?.balanceCopper ?? 0),
    );
  });

  it("attributes held items to label-only seats by name so uneven holds are not reported as even", () => {
    // Guests / draft roster often join with personId null while loot lines carry a people UUID.
    const result = splitPot(
      [
        line({
          id: "a",
          itemName: "Épée",
          personName: "Aldren",
          personId: "people-uuid-aldren",
          unitCopper: 200,
        }),
      ],
      [
        { id: "p1", personId: null, name: "Aldren", joinedAt: "2026-10-22T17:00:00Z", leftAt: null },
        { id: "p2", personId: null, name: "Mira", joinedAt: "2026-10-22T17:00:00Z", leftAt: null },
      ],
      "value",
    );
    const members = settlementMembers(result.balances);
    const alderen = members.find((row) => row.name === "Aldren");
    const mira = members.find((row) => row.name === "Mira");
    assert.equal(alderen?.lootedCopper, 200);
    assert.equal(mira?.lootedCopper, 0);
    assert.equal(alderen?.shareCopper, 100);
    assert.equal(mira?.shareCopper, 100);
    assert.equal(alderen?.balanceCopper, 100);
    assert.equal(mira?.balanceCopper, -100);
    assert.equal(result.balances.some((row) => row.joinedAt == null), false);
    assert.deepEqual(result.transfers, [
      {
        from: "Aldren",
        to: "Mira",
        fromPresenceId: "p1",
        toPresenceId: "p2",
        copper: 100,
      },
    ]);
  });

  it("attributes item holds by name even when coin lines are also in the pot", () => {
    // Mirrors the Group bug: before name attribution, item value never landed on label seats.
    const seats = [
      { id: "aby", personId: null as string | null, name: "Aby", joinedAt: "2026-10-22T17:00:00Z", leftAt: null },
      { id: "drop", personId: null, name: "Dropboar", joinedAt: "2026-10-22T17:00:00Z", leftAt: null },
      { id: "visor", personId: null, name: "Visor", joinedAt: "2026-10-22T17:00:00Z", leftAt: null },
      { id: "zan", personId: null, name: "Zaniel", joinedAt: "2026-10-22T17:00:00Z", leftAt: null },
      { id: "kayle", personId: null, name: "Kayle", joinedAt: "2026-10-22T17:00:00Z", leftAt: null },
      { id: "tz", personId: null, name: "Tzarnn", joinedAt: "2026-10-22T17:00:00Z", leftAt: null },
    ];
    const result = splitPot(
      [
        line({
          id: "coins",
          itemName: COIN_LOOT_ITEM_NAME,
          personName: "Zaniel",
          personId: "uuid-zaniel",
          unitCopper: 3300,
        }),
        line({
          id: "sword",
          itemName: "Épée",
          personName: "Aby",
          personId: "uuid-aby",
          unitCopper: 1200,
        }),
        line({
          id: "ring",
          itemName: "Anneau",
          personName: "Dropboar",
          personId: "uuid-drop",
          unitCopper: 360,
        }),
      ],
      seats,
      "value",
    );
    const members = settlementMembers(result.balances);
    const byName = (name: string) => members.find((row) => row.name === name);
    // Holds = items only (coins already split in-game, shown in session totals).
    assert.equal(byName("Aby")?.lootedCopper, 1200);
    assert.equal(byName("Dropboar")?.lootedCopper, 360);
    assert.equal(byName("Visor")?.lootedCopper, 0);
    assert.equal(byName("Zaniel")?.lootedCopper, 0);
    assert.equal(result.splitCoinCopper, 3300);
    assert.equal(result.lootCopper, 1560);
    assert.equal(result.balances.some((row) => row.joinedAt == null), false);
    assert.equal(members.every((row) => row.balanceCopper < 0), false);
    assert.ok((byName("Aby")?.balanceCopper ?? 0) > 0);
    assert.ok(result.transfers.length > 0);
    assert.ok(result.transfers.some((transfer) => transfer.from === "Aby"));
  });

  it("attributes items by name when seat personId does not match the loot people UUID", () => {
    const result = splitPot(
      [
        line({
          id: "a",
          itemName: "Épée",
          personName: "Aby",
          personId: "loot-people-uuid",
          unitCopper: 400,
        }),
      ],
      [
        { id: "p1", personId: "stale-presence-uuid", name: "Aby", joinedAt: "2026-10-22T17:00:00Z", leftAt: null },
        { id: "p2", personId: "other-uuid", name: "Kayle", joinedAt: "2026-10-22T17:00:00Z", leftAt: null },
      ],
      "value",
    );
    assert.equal(result.balances.find((row) => row.key === "p1")?.lootedCopper, 400);
    assert.equal(result.balances.find((row) => row.key === "p2")?.lootedCopper, 0);
    assert.equal(result.transfers[0]?.from, "Aby");
  });
});

describe("party", () => {
  it("keeps new loot in the open group and drops it from the pot on reset", () => {
    const file = path.join(os.tmpdir(), `registre-groupe-${Date.now()}-${Math.random()}.sqlite`);
    const db = openDatabase(file);
    try {
      assert.equal(readParty(db).party, null);
      const opened = startParty(db, [{ label: "Place" }]);
      assert.equal(opened.party?.presences.length, 1);
      assert.equal(opened.party?.presences[0]?.name, "Place");
      assert.equal(opened.party?.presences[0]?.joinedAt, opened.party?.startedAt);
      resetParty(db);
      startParty(db);
      db.prepare("UPDATE parties SET started_at = ? WHERE status = 'open'").run("2026-10-22T10:00:00.000Z");
      const events = parseLedgerDocument(
        {
          c05: "Aldren",
          c01: [{ f01: "act_13", f03: [{ d04: "Objet fictif" }], f04: "2026-10-22T11:00:00Z", f07: "Aldren" }],
        },
        origin,
      ).loot;
      assert.equal(ingestLoot(db, events).added, 1);
      upsertPrice(db, "Objet fictif", 250);
      const alderen = db.prepare("SELECT id FROM people").get() as { id: string };
      const joined = joinParty({ personId: alderen.id }, db, "2026-10-22T10:00:00.000Z");
      const alderenPresence = joined.party?.presences[0]?.id;
      assert.ok(alderenPresence);
      const withMira = joinParty({ label: "Mira" }, db, "2026-10-22T10:00:00.000Z");
      const mira = withMira.party?.presences.find((presence) => presence.name === "Mira");
      assert.ok(mira);
      assert.equal(withMira.split?.balances.find((row) => row.key === mira.id)?.shareCopper, 125);
      assert.equal(withMira.split?.balances.find((row) => row.key === alderenPresence)?.shareCopper, 125);

      leaveParty(mira.id, db, "2026-10-22T12:00:00.000Z");
      const settled = settlePartyPresence(mira.id, db);
      assert.equal(settled.split?.balances.find((row) => row.key === mira.id)?.balanceCopper, 0);
      assert.equal(settled.split?.settled.length, 1);

      const withLira = joinParty({ label: "Lira" }, db, "2026-10-22T12:30:00.000Z");
      const lira = withLira.party?.presences.find((presence) => presence.name === "Lira");
      assert.ok(lira);
      const later = parseLedgerDocument(
        {
          c05: "Aldren",
          c01: [{ f01: "act_13", f03: [{ d04: "Objet fictif" }], f04: "2026-10-22T13:00:00Z", f07: "Aldren" }],
        },
        origin,
      ).loot;
      assert.equal(ingestLoot(db, later).added, 1);
      upsertPrice(db, "Objet fictif", 250);
      const continued = readParty(db);
      const share = (id: string) => continued.split?.balances.find((row) => row.key === id)?.shareCopper;
      assert.equal(share(mira.id), 125);
      assert.equal(share(lira.id), 125);
      assert.equal(share(alderenPresence), 250);
      assert.equal(continued.split?.balances.find((row) => row.key === mira.id)?.balanceCopper, 0);
      resetParty(db);
      const after = readParty(db);
      assert.equal(after.party, null);
      assert.equal(after.lines.length, 0);
      const kept = db.prepare("SELECT COUNT(*) AS n FROM loot_entries").get() as { n: number };
      assert.equal(Number(kept.n), 2);
    } finally {
      db.close();
      fs.rmSync(file, { force: true });
      fs.rmSync(`${file}-wal`, { force: true });
      fs.rmSync(`${file}-shm`, { force: true });
    }
  });

  it("records every value-split transfer in one settle-everyone call", () => {
    const file = path.join(os.tmpdir(), `registre-groupe-${Date.now()}-${Math.random()}.sqlite`);
    const db = openDatabase(file);
    try {
      startParty(db);
      db.prepare("UPDATE parties SET started_at = ?, mode = ? WHERE status = 'open'").run(
        "2026-10-22T10:00:00.000Z",
        "value",
      );
      const events = parseLedgerDocument(
        {
          c05: "Aldren",
          c01: [{ f01: "act_13", f03: [{ d04: "Épée" }], f04: "2026-10-22T11:00:00Z", f07: "Aldren" }],
        },
        origin,
      ).loot;
      assert.equal(ingestLoot(db, events).added, 1);
      upsertPrice(db, "Épée", 600);
      const alderen = db.prepare("SELECT id FROM people").get() as { id: string };
      joinParty({ personId: alderen.id }, db, "2026-10-22T10:00:00.000Z");
      joinParty({ label: "Mira" }, db, "2026-10-22T10:00:00.000Z");
      const before = readParty(db);
      assert.ok(before.split);
      assert.equal(before.split.transfers.length > 0, true);
      const planned = before.split.transfers.length;
      const after = settlePartyEveryone(db);
      assert.equal(after.split?.transfers.length, 0);
      assert.equal(after.split?.settled.length, planned);
      assert.equal(
        after.split?.balances.every((row) => row.joinedAt == null || row.balanceCopper === 0),
        true,
      );
    } finally {
      db.close();
      fs.rmSync(file, { force: true });
      fs.rmSync(`${file}-wal`, { force: true });
      fs.rmSync(`${file}-shm`, { force: true });
    }
  });

  it("shows a saved price on loot picked up after the price was saved", () => {
    const file = path.join(os.tmpdir(), `registre-groupe-${Date.now()}-${Math.random()}.sqlite`);
    const db = openDatabase(file);
    try {
      startParty(db, [{ label: "Aldren" }]);
      db.prepare("UPDATE parties SET started_at = ? WHERE status = 'open'").run("2026-10-22T10:00:00.000Z");
      upsertPrice(db, "Raw Rat Meat", 2);
      const events = parseLedgerDocument(
        {
          c05: "Aldren",
          c01: [{ f01: "act_13", f03: [{ d04: "Raw Rat Meat" }], f04: "2026-10-22T11:00:00Z", f07: "Aldren" }],
        },
        origin,
      ).loot;
      assert.equal(ingestLoot(db, events).added, 1);
      const stored = db.prepare("SELECT unit_copper FROM loot_entries").get() as { unit_copper: number | null };
      assert.equal(stored.unit_copper, null);
      const party = readParty(db);
      assert.equal(party.lines.length, 1);
      assert.equal(party.lines[0]?.itemName, "Raw Rat Meat");
      assert.equal(party.lines[0]?.unitCopper, 2);
      assert.equal(party.split?.totalCopper, 2);
    } finally {
      db.close();
      fs.rmSync(file, { force: true });
      fs.rmSync(`${file}-wal`, { force: true });
      fs.rmSync(`${file}-shm`, { force: true });
    }
  });

  it("gives every draft member the party started_at so fair shares stay equal", () => {
    const file = path.join(os.tmpdir(), `registre-groupe-${Date.now()}-${Math.random()}.sqlite`);
    const db = openDatabase(file);
    try {
      const opened = startParty(db, [{ label: "Aldren" }, { label: "Mira" }, { label: "Lira" }]);
      assert.ok(opened.party);
      assert.equal(opened.party.presences.length, 3);
      assert.equal(
        opened.party.presences.every((presence) => presence.joinedAt === opened.party?.startedAt),
        true,
      );
      db.prepare("UPDATE parties SET started_at = ? WHERE status = 'open'").run("2026-10-22T10:00:00.000Z");
      db.prepare("UPDATE party_presence SET joined_at = ?").run("2026-10-22T10:00:00.000Z");
      const events = parseLedgerDocument(
        {
          c05: "Aldren",
          c01: [
            { f01: "act_13", f03: [{ d04: "Épée" }], f04: "2026-10-22T10:05:00Z", f07: "Aldren" },
            { f01: "act_13", f03: [{ d04: "Anneau" }], f04: "2026-10-22T10:10:00Z", f07: "Aldren" },
          ],
        },
        origin,
      ).loot;
      assert.equal(ingestLoot(db, events).added, 2);
      upsertPrice(db, "Épée", 600);
      upsertPrice(db, "Anneau", 400);
      const view = readParty(db);
      const shares = (view.split?.balances ?? []).map((row) => row.shareCopper);
      assert.deepEqual(shares, [334, 333, 333]);
    } finally {
      db.close();
      fs.rmSync(file, { force: true });
      fs.rmSync(`${file}-wal`, { force: true });
      fs.rmSync(`${file}-shm`, { force: true });
    }
  });

  it("backdates open-group joins to started_at while the pot is still empty", () => {
    const file = path.join(os.tmpdir(), `registre-groupe-${Date.now()}-${Math.random()}.sqlite`);
    const db = openDatabase(file);
    try {
      const opened = startParty(db, [{ label: "Aldren" }]);
      const startedAt = opened.party?.startedAt;
      assert.ok(startedAt);
      const withMira = joinParty({ label: "Mira" }, db);
      const mira = withMira.party?.presences.find((presence) => presence.name === "Mira");
      assert.equal(mira?.joinedAt, startedAt);
      const withLira = joinParty({ label: "Lira" }, db);
      assert.equal(
        withLira.party?.presences.every((presence) => presence.joinedAt === startedAt),
        true,
      );
      db.prepare("UPDATE parties SET started_at = ? WHERE status = 'open'").run("2026-10-22T10:00:00.000Z");
      db.prepare("UPDATE party_presence SET joined_at = ?").run("2026-10-22T10:00:00.000Z");
      const events = parseLedgerDocument(
        {
          c05: "Aldren",
          c01: [{ f01: "act_13", f03: [{ d04: "Épée" }], f04: "2026-10-22T10:05:00Z", f07: "Aldren" }],
        },
        origin,
      ).loot;
      assert.equal(ingestLoot(db, events).added, 1);
      upsertPrice(db, "Épée", 900);
      const view = readParty(db);
      assert.equal(view.split?.balances.every((row) => row.shareCopper === 300), true);
    } finally {
      db.close();
      fs.rmSync(file, { force: true });
      fs.rmSync(`${file}-wal`, { force: true });
      fs.rmSync(`${file}-shm`, { force: true });
    }
  });

  it("keeps mid-loot open joins at now so late arrivals miss earlier loot", () => {
    const file = path.join(os.tmpdir(), `registre-groupe-${Date.now()}-${Math.random()}.sqlite`);
    const db = openDatabase(file);
    try {
      startParty(db, [{ label: "Aldren" }]);
      db.prepare("UPDATE parties SET started_at = ? WHERE status = 'open'").run("2026-10-22T10:00:00.000Z");
      db.prepare("UPDATE party_presence SET joined_at = ?").run("2026-10-22T10:00:00.000Z");
      const events = parseLedgerDocument(
        {
          c05: "Aldren",
          c01: [
            { f01: "act_13", f03: [{ d04: "Épée" }], f04: "2026-10-22T10:05:00Z", f07: "Aldren" },
            { f01: "act_13", f03: [{ d04: "Anneau" }], f04: "2026-10-22T10:10:00Z", f07: "Aldren" },
          ],
        },
        origin,
      ).loot;
      assert.equal(ingestLoot(db, events).added, 2);
      upsertPrice(db, "Épée", 600);
      upsertPrice(db, "Anneau", 400);
      joinParty({ label: "Mira" }, db, "2026-10-22T10:07:00.000Z");
      joinParty({ label: "Lira" }, db, "2026-10-22T10:12:00.000Z");
      const view = readParty(db);
      const share = (name: string) => view.split?.balances.find((row) => row.name === name)?.shareCopper;
      assert.equal(share("Aldren"), 800);
      assert.equal(share("Mira"), 200);
      assert.equal(share("Lira"), 0);
    } finally {
      db.close();
      fs.rmSync(file, { force: true });
      fs.rmSync(`${file}-wal`, { force: true });
      fs.rmSync(`${file}-shm`, { force: true });
    }
  });

  it("attributes priced items to label-started members so holds are not coin-only", () => {
    const file = path.join(os.tmpdir(), `registre-groupe-${Date.now()}-${Math.random()}.sqlite`);
    const db = openDatabase(file);
    try {
      startParty(db, [{ label: "Aby" }, { label: "Kayle" }]);
      db.prepare("UPDATE parties SET started_at = ?, mode = ? WHERE status = 'open'").run(
        "2026-10-22T10:00:00.000Z",
        "value",
      );
      db.prepare("UPDATE party_presence SET joined_at = ?").run("2026-10-22T10:00:00.000Z");
      const events = parseLedgerDocument(
        {
          c05: "Aby",
          c01: [
            { f01: "act_13", f03: [{ d04: "Épée" }], f04: "2026-10-22T11:00:00Z", f07: "Aby" },
            {
              f01: "act_14",
              f03: [{ d11: 49, d12: "0,0,0,49", d14: "npc_corpse" }],
              f04: "2026-10-22T11:01:00Z",
              f07: "Aby",
            },
          ],
        },
        { characterFromPath: "Aby", serverFromPath: "Estaire", characterFromFile: "Aby" },
      ).loot;
      assert.equal(ingestLoot(db, events).added, 2);
      upsertPrice(db, "Épée", 200);
      const view = readParty(db);
      assert.equal(view.party?.presences.every((presence) => presence.personId == null), true);
      const aby = view.split?.balances.find((row) => row.name === "Aby");
      const kayle = view.split?.balances.find((row) => row.name === "Kayle");
      // Holds = items only (sword 200 on Aby); coins are session totals, not holds.
      assert.ok((aby?.lootedCopper ?? 0) > (kayle?.lootedCopper ?? 0));
      assert.ok((aby?.lootedCopper ?? 0) >= 200);
      assert.ok((aby?.balanceCopper ?? 0) > 0);
      assert.ok((kayle?.balanceCopper ?? 0) < 0);
      assert.ok(view.split?.transfers.some((transfer) => transfer.from === "Aby" && transfer.to === "Kayle"));
    } finally {
      db.close();
      fs.rmSync(file, { force: true });
      fs.rmSync(`${file}-wal`, { force: true });
      fs.rmSync(`${file}-shm`, { force: true });
    }
  });
});
