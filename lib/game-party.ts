import type { DatabaseSync } from "node:sqlite";

import type { PartyEventKind } from "./ledger-parse";

/** One stored in-game party event (see `ParsedPartyEvent`). */
export type GamePartyEvent = {
  observer: string;
  kind: PartyEventKind;
  name: string;
  at: string;
};

export type GameParty = {
  /** Current in-game roster as seen by the freshest observer, with when each was first seen. */
  members: Array<{ name: string; since: string }>;
  /** Everyone seen leaving (or dropped by a disband), newest last. */
  departures: Array<{ name: string; at: string }>;
  /** Time of the newest event behind `members` (null when nothing is known). */
  updatedAt: string | null;
};

export type GamePartyProposals = {
  /** In the game party but not an active member of the app group. */
  arrivals: Array<{ name: string; since: string }>;
  /** Active app members the game shows leaving after they joined the app group. */
  departures: Array<{ presenceId: string; name: string; at: string }>;
};

/** Roster older than this (no event since) is treated as stale: the game was likely closed. */
export const GAME_PARTY_STALE_MS = 12 * 60 * 60 * 1000;

const key = (name: string) => name.trim().toLowerCase();

const KIND_ORDER: Record<GamePartyEvent["kind"], number> = { create: 0, join: 1, member: 2, leave: 3, disband: 4 };

/**
 * Replay party events per observer (each local character keeps its own Social ledger), then keep
 * the roster of the observer with the newest event. Departures are merged across observers.
 */
export function replayGameParty(events: GamePartyEvent[]): GameParty {
  const byObserver = new Map<string, GamePartyEvent[]>();
  for (const event of events) {
    const list = byObserver.get(key(event.observer)) ?? [];
    list.push(event);
    byObserver.set(key(event.observer), list);
  }

  let best: { roster: Map<string, { name: string; since: string }>; last: string } | null = null;
  const departures = new Map<string, { name: string; at: string }>();
  const depart = (name: string, at: string) => departures.set(`${key(name)}|${at.slice(0, 16)}`, { name, at });

  for (const list of byObserver.values()) {
    // Same instant: a create/join resets the roster, so it must run before the lines it brings.
    list.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : KIND_ORDER[a.kind] - KIND_ORDER[b.kind]));
    const roster = new Map<string, { name: string; since: string }>();
    const add = (name: string, at: string) => {
      if (!roster.has(key(name))) roster.set(key(name), { name, since: at });
    };
    for (const event of list) {
      const self = key(event.name) === key(event.observer);
      switch (event.kind) {
        case "create":
          roster.clear();
          add(event.observer, event.at);
          break;
        case "join":
          if (self) {
            // We joined someone's party: roster lines (act_01) follow.
            roster.clear();
            add(event.observer, event.at);
          } else add(event.name, event.at);
          break;
        case "member":
          add(event.observer, event.at);
          add(event.name, event.at);
          break;
        case "leave":
          depart(event.name, event.at);
          if (self) roster.clear();
          else roster.delete(key(event.name));
          break;
        case "disband":
          for (const member of roster.values()) depart(member.name, event.at);
          roster.clear();
          break;
      }
    }
    const last = list[list.length - 1]?.at ?? "";
    if (!best || last > best.last) best = { roster, last };
  }

  return {
    members: best ? [...best.roster.values()] : [],
    departures: [...departures.values()].sort((a, b) => (a.at < b.at ? -1 : 1)),
    updatedAt: best?.last ?? null,
  };
}

/**
 * What to suggest for the open app group: game members to add (from when they joined, never
 * before the group started) and app members the game saw leave. Stale rosters suggest no arrivals.
 */
export function gamePartyProposals(
  game: GameParty,
  party: { startedAt: string; presences: Array<{ id: string; name: string; joinedAt: string; leftAt: string | null }> },
  now = Date.now(),
): GamePartyProposals {
  const active = party.presences.filter((presence) => presence.leftAt == null);
  const activeNames = new Set(active.map((presence) => key(presence.name)));
  const inGame = new Set(game.members.map((member) => key(member.name)));
  const fresh = game.updatedAt != null && now - Date.parse(game.updatedAt) <= GAME_PARTY_STALE_MS;

  const arrivals = fresh
    ? game.members
        .filter((member) => !activeNames.has(key(member.name)))
        .map((member) => ({
          name: member.name,
          since: Date.parse(member.since) < Date.parse(party.startedAt) ? party.startedAt : member.since,
        }))
    : [];

  const departures: GamePartyProposals["departures"] = [];
  for (const presence of active) {
    if (inGame.has(key(presence.name))) continue;
    const left = [...game.departures]
      .reverse()
      .find(
        (departure) =>
          key(departure.name) === key(presence.name) &&
          Date.parse(departure.at) >= Date.parse(presence.joinedAt),
      );
    if (left) departures.push({ presenceId: presence.id, name: presence.name, at: left.at });
  }
  return { arrivals, departures };
}

/** Events from the last few days are enough to rebuild the live party. */
export function readGameParty(db: DatabaseSync, sinceIso: string): GameParty {
  const rows = db
    .prepare("SELECT observer, kind, name, at FROM game_party_events WHERE at >= ? ORDER BY at")
    .all(sinceIso) as GamePartyEvent[];
  return replayGameParty(rows);
}

/** Distinct player names seen in party events recently, newest first (autocomplete). */
export function recentGamePlayers(db: DatabaseSync, sinceIso: string, limit = 40): Array<{ name: string; lastSeenAt: string }> {
  const rows = db
    .prepare(
      `SELECT name, MAX(at) AS last_seen
       FROM game_party_events
       WHERE at >= ?
       GROUP BY lower(name)
       ORDER BY last_seen DESC
       LIMIT ?`,
    )
    .all(sinceIso, limit) as Array<{ name: string; last_seen: string }>;
  return rows.map((row) => ({ name: row.name, lastSeenAt: row.last_seen }));
}
