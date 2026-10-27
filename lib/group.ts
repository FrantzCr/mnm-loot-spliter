import type { DatabaseSync } from "node:sqlite";

import { ErrorCode } from "./codes";
import { asNumber, getDb, invalidateSocialFiles } from "./db";
import { cleanText, titleCaseName } from "./format";
import { enqueueGroupResale } from "./pending-resale";
import { syncCharactersFromWatch } from "./scan";
import {
  settleEveryone,
  settlePresence,
  splitPot,
  type PotLine,
  type PresenceWindow,
  type SplitComputation,
  type SplitMode,
} from "./split";

const MAX_LABEL = 80;

export type PartyPresence = {
  id: string;
  personId: string | null;
  name: string;
  joinedAt: string;
  leftAt: string | null;
  settledAt: string | null;
};

export type PartyView = {
  party: null | {
    id: string;
    startedAt: string;
    mode: SplitMode | null;
    presences: PartyPresence[];
  };
  people: Array<{ id: string; name: string; serverName: string | null }>;
  lines: PotLine[];
  split: SplitComputation | null;
};

export type PartyMemberInput = { personId?: string | null; label?: string | null };

export function startParty(db: DatabaseSync = getDb(), members: PartyMemberInput[] = []): PartyView {
  const open = db.prepare("SELECT id FROM parties WHERE status = 'open'").get() as { id: string } | undefined;
  if (open) throw new Error(ErrorCode.groupAlreadyOpen);
  // One timestamp for the party and every draft seat — fair shares stay equal from open.
  const startedAt = new Date().toISOString();
  const partyId = crypto.randomUUID();
  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO parties (id, started_at, status, headcount, mode, updated_at)
       VALUES (?, ?, 'open', NULL, NULL, ?)`,
    ).run(partyId, startedAt, startedAt);
    for (const member of members) addPresence(db, partyId, member, startedAt);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  invalidateSocialFiles(db);
  return readParty(db);
}

/**
 * Reset pot: start a fresh split with the same roster. Bumps the party's session epoch so the
 * cleared pot's loot and settlements drop out of every group query (ledger rows are kept).
 */
export function resetPot(db: DatabaseSync = getDb(), at = new Date().toISOString()): PartyView {
  const open = openParty(db);
  if (!open) return readParty(db);
  db.exec("BEGIN");
  try {
    db.prepare(
      "UPDATE parties SET session_epoch = session_epoch + 1, pot_started_at = ?, updated_at = ? WHERE id = ?",
    ).run(at, at, open.id);
    // Roster stays; members who left stay listed but no longer weigh on the new pot.
    db.prepare("UPDATE party_presence SET settled_at = NULL WHERE party_id = ?").run(open.id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return readParty(db);
}

/** Close the open group: keep membership for history and enqueue unsold loot for resale. */
export function closeParty(db: DatabaseSync = getDb()): PartyView {
  const open = db.prepare("SELECT id FROM parties WHERE status = 'open'").get() as { id: string } | undefined;
  if (!open) throw new Error(ErrorCode.groupStartBeforeClose);
  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    enqueueGroupResale(open.id, db);
    db.prepare("UPDATE parties SET status = 'closed', updated_at = ? WHERE id = ?").run(now, open.id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  invalidateSocialFiles(db);
  return readParty(db);
}

export function setPartyMode(mode: SplitMode, db: DatabaseSync = getDb()): PartyView {
  const open = openParty(db);
  if (!open) throw new Error(ErrorCode.groupStartBeforeSplit);
  if (mode !== "items" && mode !== "value") throw new Error(ErrorCode.groupBadMode);
  db.prepare("UPDATE parties SET mode = ?, updated_at = ? WHERE id = ?").run(mode, new Date().toISOString(), open.id);
  return readParty(db);
}

export function joinParty(
  input: PartyMemberInput,
  db: DatabaseSync = getDb(),
  at?: string,
): PartyView {
  const open = openPartyRow(db);
  if (!open) throw new Error(ErrorCode.groupStartBeforeJoin);
  // Empty pot: still assembling the roster → party start. After loot: true late join → now.
  const joinAt = at ?? defaultJoinAt(db, open);
  addPresence(db, open.id, input, joinAt);
  invalidateSocialFiles(db);
  return readParty(db);
}

function defaultJoinAt(db: DatabaseSync, open: { id: string; started_at: string }): string {
  const loot = db
    .prepare(
      `SELECT 1 AS hit FROM loot_entries l JOIN parties p ON p.id = l.group_id
       WHERE l.group_id = ? AND l.group_epoch = p.session_epoch LIMIT 1`,
    )
    .get(open.id) as
    | { hit: number }
    | undefined;
  if (!loot) return open.started_at;
  return new Date().toISOString();
}

function addPresence(db: DatabaseSync, partyId: string, input: PartyMemberInput, at: string) {
  const personId = typeof input.personId === "string" && input.personId.length > 0 ? input.personId : null;
  let label = cleanText(input.label, MAX_LABEL);
  if (label) label = titleCaseName(label);
  if (personId) {
    const person = db.prepare("SELECT id, name FROM people WHERE id = ?").get(personId) as
      | { id: string; name: string }
      | undefined;
    if (!person) throw new Error(ErrorCode.personMissing);
    const already = db
      .prepare(
        "SELECT id FROM party_presence WHERE party_id = ? AND person_id = ? AND left_at IS NULL",
      )
      .get(partyId, personId) as { id: string } | undefined;
    if (already) throw new Error(ErrorCode.groupAlreadyPresent);
    label = person.name;
  }
  if (!label) throw new Error(ErrorCode.groupNeedWho);
  db.prepare(
    `INSERT INTO party_presence (id, party_id, person_id, label, joined_at, left_at, settled_at)
     VALUES (?, ?, ?, ?, ?, NULL, NULL)`,
  ).run(crypto.randomUUID(), partyId, personId, label, at);
}

export function leaveParty(presenceId: string, db: DatabaseSync = getDb(), at = new Date().toISOString()): PartyView {
  const open = openParty(db);
  if (!open) throw new Error(ErrorCode.groupStartBeforeLeave);
  const presence = presenceRow(db, open.id, presenceId);
  if (presence.left_at) throw new Error(ErrorCode.groupAlreadyLeft);
  db.prepare("UPDATE party_presence SET left_at = ? WHERE id = ?").run(at, presenceId);
  return readParty(db);
}

export function settlePartyPresence(presenceId: string, db: DatabaseSync = getDb()): PartyView {
  const open = openParty(db);
  if (!open) throw new Error(ErrorCode.groupStartBeforeSettle);
  presenceRow(db, open.id, presenceId);
  const view = readParty(db);
  const transfers = settlePresence(view.split?.balances ?? [], presenceId);
  if (transfers.length === 0) throw new Error(ErrorCode.groupAlreadySettled);
  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    const insert = db.prepare(
      `INSERT INTO party_settlements (id, party_id, from_presence_id, to_presence_id, copper, created_at, session_epoch)
       VALUES (?, ?, ?, ?, ?, ?, (SELECT session_epoch FROM parties WHERE id = ?))`,
    );
    for (const transfer of transfers) {
      insert.run(crypto.randomUUID(), open.id, transfer.fromPresenceId, transfer.toPresenceId, transfer.copper, now, open.id);
    }
    db.prepare("UPDATE party_presence SET settled_at = ? WHERE id = ?").run(now, presenceId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return readParty(db);
}

/** Record the value-split "everyone settled" transfers in one transaction. */
export function settlePartyEveryone(db: DatabaseSync = getDb()): PartyView {
  const open = openParty(db);
  if (!open) throw new Error(ErrorCode.groupStartBeforeSettle);
  const view = readParty(db);
  if (view.party?.mode === "items") throw new Error(ErrorCode.groupBadMode);
  const balances = view.split?.balances ?? [];
  const transfers = settleEveryone(balances);
  if (transfers.length === 0) throw new Error(ErrorCode.groupAlreadySettled);
  const now = new Date().toISOString();
  const involved = new Set<string>();
  for (const transfer of transfers) {
    involved.add(transfer.fromPresenceId);
    involved.add(transfer.toPresenceId);
  }
  db.exec("BEGIN");
  try {
    const insert = db.prepare(
      `INSERT INTO party_settlements (id, party_id, from_presence_id, to_presence_id, copper, created_at, session_epoch)
       VALUES (?, ?, ?, ?, ?, ?, (SELECT session_epoch FROM parties WHERE id = ?))`,
    );
    for (const transfer of transfers) {
      insert.run(crypto.randomUUID(), open.id, transfer.fromPresenceId, transfer.toPresenceId, transfer.copper, now, open.id);
    }
    const mark = db.prepare("UPDATE party_presence SET settled_at = ? WHERE id = ? AND party_id = ?");
    for (const presenceId of involved) {
      mark.run(now, presenceId, open.id);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return readParty(db);
}

function openParty(db: DatabaseSync): { id: string } | undefined {
  return db.prepare("SELECT id FROM parties WHERE status = 'open'").get() as { id: string } | undefined;
}

function openPartyRow(db: DatabaseSync): { id: string; started_at: string } | undefined {
  return db.prepare("SELECT id, started_at FROM parties WHERE status = 'open'").get() as
    | { id: string; started_at: string }
    | undefined;
}

function presenceRow(db: DatabaseSync, partyId: string, presenceId: string): { id: string; left_at: string | null } {
  const presence = db
    .prepare("SELECT id, left_at FROM party_presence WHERE id = ? AND party_id = ?")
    .get(presenceId, partyId) as { id: string; left_at: string | null } | undefined;
  if (!presence) throw new Error(ErrorCode.presenceMissing);
  return presence;
}

export function readParty(db: DatabaseSync = getDb()): PartyView {
  syncCharactersFromWatch(db);
  const people = (
    db.prepare("SELECT id, name, server_name FROM people WHERE on_machine = 1 ORDER BY name COLLATE NOCASE").all() as Array<{
      id: string;
      name: string;
      server_name: string | null;
    }>
  ).map((row) => ({ id: row.id, name: row.name, serverName: row.server_name }));

  const party = db
    .prepare("SELECT id, started_at, mode, session_epoch FROM parties WHERE status = 'open'")
    .get() as { id: string; started_at: string; mode: string | null; session_epoch: number | bigint } | undefined;
  if (!party) return { party: null, people, lines: [], split: null };

  const presences = (
    db
      .prepare(
        `SELECT id, person_id, label, joined_at, left_at, settled_at
         FROM party_presence
         WHERE party_id = ?
         ORDER BY CASE WHEN left_at IS NULL THEN 0 ELSE 1 END, joined_at, label COLLATE NOCASE`,
      )
      .all(party.id) as Array<{
      id: string;
      person_id: string | null;
      label: string;
      joined_at: string;
      left_at: string | null;
      settled_at: string | null;
    }>
  ).map((row) => ({
    id: row.id,
    personId: row.person_id,
    name: row.label,
    joinedAt: row.joined_at,
    leftAt: row.left_at,
    settledAt: row.settled_at,
  }));

  const lines = (
    db
      .prepare(
        `SELECT l.id, l.item_name, l.quantity,
                CASE
                  WHEN l.user_edited = 1 THEN l.unit_copper
                  ELSE COALESCE(l.unit_copper, b.unit_copper)
                END AS unit_copper,
                l.looted_at, p.id AS person_id, p.name AS person_name
         FROM loot_entries l
         JOIN people p ON p.id = l.person_id
         LEFT JOIN price_book b ON b.item_key = l.item_key
         WHERE l.group_id = ? AND l.group_epoch = ?
         ORDER BY CASE WHEN l.looted_at = '' THEN 1 ELSE 0 END, l.looted_at, l.created_at`,
      )
      .all(party.id, party.session_epoch) as Array<{
      id: string;
      item_name: string;
      quantity: number | bigint;
      unit_copper: number | bigint | null;
      looted_at: string;
      person_id: string;
      person_name: string;
    }>
  ).map((row) => ({
    id: row.id,
    itemName: row.item_name,
    quantity: asNumber(row.quantity),
    unitCopper: row.unit_copper == null ? null : asNumber(row.unit_copper),
    lootedAt: row.looted_at,
    personId: row.person_id,
    personName: row.person_name,
  }));

  const settlements = (
    db
      .prepare(
        `SELECT from_presence_id, to_presence_id, copper
         FROM party_settlements
         WHERE party_id = ? AND session_epoch = ?
         ORDER BY created_at`,
      )
      .all(party.id, party.session_epoch) as Array<{
      from_presence_id: string;
      to_presence_id: string;
      copper: number | bigint;
    }>
  ).map((row) => ({
    fromPresenceId: row.from_presence_id,
    toPresenceId: row.to_presence_id,
    copper: asNumber(row.copper),
  }));

  const mode = party.mode === "items" || party.mode === "value" ? party.mode : "value";
  const windows: PresenceWindow[] = presences.map((presence) => ({
    id: presence.id,
    personId: presence.personId,
    name: presence.name,
    joinedAt: presence.joinedAt,
    leftAt: presence.leftAt,
  }));

  return {
    party: { id: party.id, startedAt: party.started_at, mode: party.mode === mode ? mode : null, presences },
    people,
    lines,
    split: splitPot(lines, windows, mode, settlements),
  };
}
