import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COIN_LOOT_ITEM_NAME,
  contextFromPath,
  ownerFromLedgerPath,
  parseLedgerDocument,
} from "./ledger-parse";

/**
 * Fixtures follow the public field list (c01 / f01 / d04…).
 * They are not captured client files and must not be treated as real drops.
 */

describe("parseLedgerDocument", () => {
  it("reads an act_13 loot line and decodes the documented mob name", () => {
    const mob = Buffer.from("créature fictive", "utf8").toString("base64");
    const zone = Buffer.from("crique-test", "utf8").toString("base64");
    const report = parseLedgerDocument(
      {
        c05: "Auteur",
        c01: [
          {
            f01: "act_13",
            f03: [{ d01: 12, d02: mob, d04: "Objet fictif", d05: "id-test" }],
            f04: "2026-09-23T18:04:00-07:00",
            f05: `zone_${zone}`,
            f07: "Aldren",
          },
          { f01: "act_12", f03: [{ d04: "Pas un butin" }], f04: "2026-09-23T18:05:00-07:00" },
        ],
      },
      { characterFromPath: "Dossier", serverFromPath: "Estaire", characterFromFile: "Fichier" },
    );

    assert.equal(report.problem, null);
    assert.equal(report.loot.length, 1);
    assert.equal(report.loot[0].characterName, "Aldren");
    assert.equal(report.loot[0].serverName, "Estaire");
    assert.equal(report.loot[0].itemName, "Objet fictif");
    assert.equal(report.loot[0].quantity, 1);
    assert.equal(report.loot[0].source, "créature fictive");
    assert.equal(report.loot[0].zone, "crique-test");
    assert.equal(report.loot[0].lootedAt, "2026-09-23T18:04:00-07:00");
    assert.equal(report.actionCodes.includes("act_12"), true);
  });

  it("keeps the same identity for the same event and distinguishes true duplicates", () => {
    const event = {
      f01: "act_13",
      f03: [{ d04: "Objet fictif" }],
      f04: "2026-09-23T18:04:00Z",
      f07: "Aldren",
    };
    const origin = { characterFromPath: null, serverFromPath: null, characterFromFile: null };
    const once = parseLedgerDocument({ c05: "Aldren", c01: [event] }, origin);
    const twice = parseLedgerDocument({ c05: "Aldren", c01: [event, event] }, origin);
    assert.equal(twice.loot[0].dedupeKey, once.loot[0].dedupeKey);
    assert.notEqual(twice.loot[0].dedupeKey, twice.loot[1].dedupeKey);
  });

  it("reads the character name from the ledger file name", () => {
    const owner = ownerFromLedgerPath(
      "C:/Users/Joueur/AppData/LocalLow/Niche Worlds Cult/Monsters and Memories/Estaire/Mira/Ledger/Mira_Character_2026-09-23.json",
    );
    assert.equal(owner?.name, "Mira");
    assert.equal(owner?.serverName, "Estaire");
    assert.equal(ownerFromLedgerPath("C:/notes/pas-un-journal.json"), null);
  });

  it("accepts a single detail object and falls back to the folder name", () => {
    const report = parseLedgerDocument(
      { c01: [{ f01: "act_13", f03: { d04: "Objet fictif" }, f04: "2026-09-23T18:04:00Z" }] },
      contextFromPath(
        "C:/Users/Joueur/AppData/LocalLow/Niche Worlds Cult/Monsters and Memories/Estaire/Mira/Ledger/Mira_Character_2026-09-23.json",
      ),
    );
    assert.equal(report.loot.length, 1);
    assert.equal(report.loot[0].characterName, "Mira");
    assert.equal(report.loot[0].serverName, "Estaire");
  });

  it("reports a file that is not a ledger object", () => {
    const report = parseLedgerDocument([], {
      characterFromPath: null,
      serverFromPath: null,
      characterFromFile: null,
    });
    assert.match(report.problem ?? "", /JSON object/);
    assert.equal(report.loot.length, 0);
  });

  it("reads item details when the client stores f03 as a JSON string", () => {
    const mob = Buffer.from("créature fictive", "utf8").toString("base64");
    const report = parseLedgerDocument(
      {
        c05: "Aby",
        c01: [
          {
            f01: "act_13",
            f02: "ignored",
            f03: JSON.stringify({ d01: 1, d02: mob, d03: "", d04: "Objet fictif", d05: "id-test" }),
            f04: "2026-10-22T16:01:21.989768+02:00",
            f07: "Aby",
          },
        ],
      },
      { characterFromPath: "Aby", serverFromPath: "vespyra", characterFromFile: "Aby" },
    );
    assert.equal(report.loot.length, 1);
    assert.equal(report.skippedWithoutItem, 0);
    assert.equal(report.loot[0].itemName, "Objet fictif");
    assert.equal(report.loot[0].source, "créature fictive");
    assert.equal(report.loot[0].lootedAt, "2026-10-22T16:01:21.989768+02:00");
  });

  it("reads an act_24 vendor sale and leaves loot to act_13 only", () => {
    const price = Buffer.from("0 platinum 0 gold 1 silver 50 copper", "utf8").toString("base64");
    const report = parseLedgerDocument(
      {
        c05: "Auteur",
        c01: [
          {
            f01: "act_24",
            f03: JSON.stringify({ d01: 2, d03: price, d04: "Objet fictif", d05: "id-vente" }),
            f04: "2026-10-22T17:19:19+02:00",
            f05: `zone_${Buffer.from("crique-test", "utf8").toString("base64")}`,
            f07: "Aldren",
          },
          {
            f01: "act_24",
            f03: JSON.stringify({ d04: "Autre objet fictif" }),
            f04: "2026-10-22T17:19:20+02:00",
            f07: "Aldren",
          },
          { f01: "act_12", f03: [{ d04: "Pas un butin" }], f04: "2026-10-22T17:19:21+02:00" },
          {
            f01: "act_13",
            f03: JSON.stringify({ d01: 9, d04: "Butin fictif" }),
            f04: "2026-10-22T17:19:22+02:00",
            f07: "Aldren",
          },
        ],
      },
      { characterFromPath: "Dossier", serverFromPath: "Estaire", characterFromFile: "Fichier" },
    );

    assert.equal(report.problem, null);
    assert.equal(report.loot.length, 1);
    assert.equal(report.loot[0].itemName, "Butin fictif");
    assert.equal(report.loot[0].quantity, 1);
    assert.equal(report.sales.length, 2);
    assert.equal(report.sales[0].characterName, "Aldren");
    assert.equal(report.sales[0].serverName, "Estaire");
    assert.equal(report.sales[0].itemName, "Objet fictif");
    assert.equal(report.sales[0].quantity, 2);
    assert.equal(report.sales[0].soldAt, "2026-10-22T17:19:19+02:00");
    assert.equal(report.sales[0].copper, 150);
    assert.equal(report.sales[0].zone, "crique-test");
    assert.equal(report.sales[1].itemName, "Autre objet fictif");
    assert.equal(report.sales[1].quantity, 1);
    assert.equal(report.sales[1].copper, null);
    assert.equal(report.sales[1].zone, null);
    assert.equal(report.actionCodes.includes("act_24"), true);
  });

  it("skips a loot event with no item name", () => {
    const report = parseLedgerDocument(
      { c05: "Aldren", c01: [{ f01: "act_13", f03: [{ d01: 4 }], f04: "2026-09-23T18:04:00Z" }] },
      { characterFromPath: null, serverFromPath: null, characterFromFile: null },
    );
    assert.equal(report.loot.length, 0);
    assert.equal(report.skippedWithoutItem, 1);
  });

  it("reads act_14 corpse coins for party_split and npc_corpse, not trades", () => {
    const mob = Buffer.from("a restless skeleton", "utf8").toString("base64");
    const report = parseLedgerDocument(
      {
        c05: "Aby",
        c01: [
          {
            f01: "act_14",
            f03: JSON.stringify({
              d11: 29,
              d12: Buffer.from("0,0,0,29", "utf8").toString("base64"),
              d13: mob,
              d14: "party_split",
              // Observer share after auto-split — must NOT replace d11.
              d15: "0,0,0,5",
            }),
            f04: "2026-10-20T10:58:47+02:00",
            f07: "Brachus",
            f09: "Aby",
          },
          {
            f01: "act_14",
            f03: JSON.stringify({ d11: 49, d12: "0,0,0,49", d13: mob, d14: "npc_corpse", d15: "" }),
            f04: "2026-10-20T10:59:37+02:00",
            f07: "Aby",
            f09: "Aby",
          },
          {
            f01: "act_14",
            f03: JSON.stringify({ d11: 10, d12: "0,0,0,10", d13: mob, d14: "something_else" }),
            f04: "2026-10-20T11:00:00+02:00",
            f07: "Mira",
          },
          {
            f01: "act_16",
            f03: JSON.stringify({ tradingGp: 1, d04: "ignored" }),
            f04: "2026-10-20T11:01:00+02:00",
            f07: "Aby",
          },
        ],
      },
      { characterFromPath: "Aby", serverFromPath: "vespyra", characterFromFile: "Aby" },
    );

    assert.equal(report.problem, null);
    assert.equal(report.loot.length, 2);
    assert.equal(report.loot[0].itemName, COIN_LOOT_ITEM_NAME);
    assert.equal(report.loot[0].characterName, "Brachus");
    // Full corpse pile (d11), not the observer share in d15 (5).
    assert.equal(report.loot[0].unitCopper, 29);
    assert.equal(report.loot[0].source, "a restless skeleton");
    assert.equal(report.loot[1].characterName, "Aby");
    assert.equal(report.loot[1].unitCopper, 49);
    assert.equal(report.sales.length, 0);
  });

  it("keeps party_split d11 as the full corpse total when d15 is a smaller share", () => {
    // Real Social pattern: d11/d15 ≈ party size (e.g. 65/13 = 5).
    const mob = Buffer.from("a wererat", "utf8").toString("base64");
    const report = parseLedgerDocument(
      {
        c05: "Aby",
        c01: [
          {
            f01: "act_14",
            f03: JSON.stringify({
              d11: 65,
              d12: "0,0,0,65",
              d13: mob,
              d14: "party_split",
              d15: "0,0,0,13",
            }),
            f04: "2026-10-08T13:43:27+02:00",
            f07: "Spilled",
            f09: "Aby",
          },
        ],
      },
      { characterFromPath: "Aby", serverFromPath: "vespyra", characterFromFile: "Aby" },
    );
    assert.equal(report.loot.length, 1);
    assert.equal(report.loot[0].unitCopper, 65);
    assert.notEqual(report.loot[0].unitCopper, 13);
  });
});
