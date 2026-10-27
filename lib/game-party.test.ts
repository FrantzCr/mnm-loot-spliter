import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { gamePartyProposals, replayGameParty, type GamePartyEvent } from "./game-party";

const at = (time: string) => `2026-10-27T${time}:00+01:00`;
const ev = (observer: string, kind: GamePartyEvent["kind"], name: string, time: string): GamePartyEvent => ({
  observer,
  kind,
  name,
  at: at(time),
});

// Shape of Aby's real Social ledger on 2026-10-27 (join, roster lines, leaves, disband).
const morning: GamePartyEvent[] = [
  ev("Aby", "join", "Aby", "01:26"),
  ev("Aby", "member", "Shorn", "01:26"),
  ev("Aby", "member", "Elvysh", "01:26"),
  ev("Aby", "member", "Yme", "01:26"),
  ev("Aby", "member", "Tasoret", "01:26"),
  ev("Aby", "member", "Gruton", "01:27"),
];

describe("replayGameParty", () => {
  it("rebuilds the roster from a join and the roster lines that follow", () => {
    const game = replayGameParty(morning);
    assert.deepEqual(
      game.members.map((member) => member.name).sort(),
      ["Aby", "Elvysh", "Gruton", "Shorn", "Tasoret", "Yme"],
    );
    assert.equal(game.departures.length, 0);
  });

  it("drops leavers and records when they left; a disband empties the roster", () => {
    const later = [...morning, ev("Aby", "leave", "Tasoret", "02:24"), ev("Aby", "join", "Nox", "02:30")];
    const game = replayGameParty(later);
    assert.ok(!game.members.some((member) => member.name === "Tasoret"));
    assert.ok(game.members.some((member) => member.name === "Nox" && member.since === at("02:30")));
    assert.deepEqual(game.departures, [{ name: "Tasoret", at: at("02:24") }]);

    const ended = replayGameParty([...later, ev("Aby", "disband", "Elvysh", "03:00")]);
    assert.equal(ended.members.length, 0);
    assert.ok(ended.departures.some((departure) => departure.name === "Yme" && departure.at === at("03:00")));
  });
});

describe("replayGameParty ordering", () => {
  it("keeps the leader named by a join even when the leader line comes first at the same instant", () => {
    const game = replayGameParty([ev("Aby", "member", "Elvysh", "02:26"), ev("Aby", "join", "Aby", "02:26")]);
    assert.deepEqual(game.members.map((member) => member.name).sort(), ["Aby", "Elvysh"]);
  });
});

describe("gamePartyProposals", () => {
  const party = {
    startedAt: at("01:20"),
    presences: [
      { id: "p-aby", name: "Aby", joinedAt: at("01:20"), leftAt: null },
      { id: "p-shorn", name: "Shorn", joinedAt: at("01:20"), leftAt: null },
      { id: "p-tas", name: "Tasoret", joinedAt: at("01:20"), leftAt: null },
    ],
  };
  const now = Date.parse(at("02:40"));

  it("suggests adding game members missing from the app group, from when they joined", () => {
    const game = replayGameParty([...morning, ev("Aby", "join", "Nox", "02:30")]);
    const { arrivals } = gamePartyProposals(game, party, now);
    assert.deepEqual(
      arrivals.map((arrival) => arrival.name).sort(),
      ["Elvysh", "Gruton", "Nox", "Yme"],
    );
    assert.equal(arrivals.find((arrival) => arrival.name === "Nox")?.since, at("02:30"));
  });

  it("suggests a leave at the game time for app members the game saw leave", () => {
    const game = replayGameParty([...morning, ev("Aby", "leave", "Tasoret", "02:24")]);
    const { departures } = gamePartyProposals(game, party, now);
    assert.deepEqual(departures, [{ presenceId: "p-tas", name: "Tasoret", at: at("02:24") }]);
  });

  it("ignores a stale roster for arrivals", () => {
    const game = replayGameParty(morning);
    const { arrivals } = gamePartyProposals(game, party, Date.parse("2026-10-28T20:00:00+01:00"));
    assert.equal(arrivals.length, 0);
  });
});
