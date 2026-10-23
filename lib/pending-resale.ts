import type { DatabaseSync } from "node:sqlite";

import { ErrorCode } from "./codes";
import { asNumber, getDb } from "./db";
import { itemKey } from "./format";
import { COIN_LOOT_ITEM_NAME } from "./ledger-parse";
import { isPoolOnlyLine } from "./split";

export const RECENT_PLAYERS_LIMIT = 10;
/** Fuller closed-group history for name-field autocomplete (not the recent-players list UI). */
export const PLAYER_SUGGESTIONS_LIMIT = 100;

export type PendingResaleItem = {
  id: string;
  itemKey: string;
  itemName: string;
  quantity: number;
  unitCopper: number | null;
  lineCopper: number | null;
  partyId: string | null;
  updatedAt: string;
};

export type RecentPlayer = {
  name: string;
  personId: string | null;
  lastPlayedAt: string;
  groupStartedAt: string;
};

/** Aggregate sellable loot lines by item key (excludes corpse coins). */
export function aggregateSellableLoot(
  lines: Array<{ itemName: string; quantity: number; unitCopper: number | null }>,
): Array<{ itemKey: string; itemName: string; quantity: number; unitCopper: number | null }> {
  const order: string[] = [];
  const grouped = new Map<string, { itemKey: string; itemName: string; quantity: number; unitCopper: number | null }>();
  for (const line of lines) {
    if (isPoolOnlyLine(line) || itemKey(line.itemName) === itemKey(COIN_LOOT_ITEM_NAME)) continue;
    if (!Number.isInteger(line.quantity) || line.quantity < 1) continue;
    const key = itemKey(line.itemName);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        itemKey: key,
        itemName: line.itemName,
        quantity: line.quantity,
        unitCopper: line.unitCopper,
      });
      order.push(key);
      continue;
    }
    existing.quantity += line.quantity;
    if (existing.unitCopper == null && line.unitCopper != null) existing.unitCopper = line.unitCopper;
  }
  return order.map((key) => grouped.get(key)!);
}

/** Reduce remaining qty for a sold stack; returns leftover that did not match a queue row. */
export function reducePendingQuantity(
  remaining: number,
  soldQuantity: number,
): { nextQuantity: number; consumed: number } {
  if (!Number.isInteger(remaining) || remaining < 1) return { nextQuantity: 0, consumed: 0 };
  if (!Number.isInteger(soldQuantity) || soldQuantity < 1) return { nextQuantity: remaining, consumed: 0 };
  const consumed = Math.min(remaining, soldQuantity);
  return { nextQuantity: remaining - consumed, consumed };
}

export function enqueueGroupResale(partyId: string, db: DatabaseSync = getDb()) {
  const lines = db
    .prepare(
      `SELECT l.item_name, l.quantity,
              CASE
                WHEN l.user_edited = 1 THEN l.unit_copper
                ELSE COALESCE(l.unit_copper, b.unit_copper)
              END AS unit_copper
       FROM loot_entries l
       LEFT JOIN price_book b ON b.item_key = l.item_key
       WHERE l.group_id = ?`,
    )
    .all(partyId) as Array<{
    item_name: string;
    quantity: number | bigint;
    unit_copper: number | bigint | null;
  }>;

  const aggregated = aggregateSellableLoot(
    lines.map((row) => ({
      itemName: row.item_name,
      quantity: asNumber(row.quantity),
      unitCopper: row.unit_copper == null ? null : asNumber(row.unit_copper),
    })),
  );
  if (aggregated.length === 0) return;

  const now = new Date().toISOString();
  const upsert = db.prepare(
    `INSERT INTO pending_resale (id, item_key, item_name, quantity, unit_copper, party_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(item_key) DO UPDATE SET
       item_name = excluded.item_name,
       quantity = pending_resale.quantity + excluded.quantity,
       unit_copper = COALESCE(excluded.unit_copper, pending_resale.unit_copper),
       party_id = excluded.party_id,
       updated_at = excluded.updated_at`,
  );
  for (const item of aggregated) {
    upsert.run(
      crypto.randomUUID(),
      item.itemKey,
      item.itemName,
      item.quantity,
      item.unitCopper,
      partyId,
      now,
      now,
    );
  }
}

export function listPendingResale(db: DatabaseSync = getDb()): PendingResaleItem[] {
  const rows = db
    .prepare(
      `SELECT p.id, p.item_key, p.item_name, p.quantity, p.party_id, p.updated_at,
              COALESCE(b.unit_copper, p.unit_copper) AS unit_copper
       FROM pending_resale p
       LEFT JOIN price_book b ON b.item_key = p.item_key
       ORDER BY p.updated_at DESC, p.item_name COLLATE NOCASE`,
    )
    .all() as Array<{
    id: string;
    item_key: string;
    item_name: string;
    quantity: number | bigint;
    party_id: string | null;
    updated_at: string;
    unit_copper: number | bigint | null;
  }>;

  return rows.map((row) => {
    const quantity = asNumber(row.quantity);
    const unitCopper = row.unit_copper == null ? null : asNumber(row.unit_copper);
    return {
      id: row.id,
      itemKey: row.item_key,
      itemName: row.item_name,
      quantity,
      unitCopper,
      lineCopper: unitCopper == null ? null : quantity * unitCopper,
      partyId: row.party_id,
      updatedAt: row.updated_at,
    };
  });
}

export function dismissPendingResale(id: string, db: DatabaseSync = getDb()) {
  const info = db.prepare("DELETE FROM pending_resale WHERE id = ?").run(id);
  if (Number(info.changes) === 0) throw new Error(ErrorCode.pendingMissing);
}

export function dismissAllPendingResale(db: DatabaseSync = getDb()) {
  db.prepare("DELETE FROM pending_resale").run();
}

export function recentPlayerDismissKey(name: string, personId: string | null): string {
  return `${name.trim().toLowerCase()}|${personId ?? ""}`;
}

export function dismissRecentPlayer(
  name: unknown,
  personId: unknown,
  db: DatabaseSync = getDb(),
) {
  const label = typeof name === "string" ? name.trim() : "";
  if (!label) throw new Error(ErrorCode.groupNeedWho);
  const id =
    typeof personId === "string" && personId.trim() !== "" ? personId.trim() : null;
  const key = recentPlayerDismissKey(label, id);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO dismissed_recent_players (dismiss_key, name, person_id, dismissed_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(dismiss_key) DO UPDATE SET
       name = excluded.name,
       person_id = excluded.person_id,
       dismissed_at = excluded.dismissed_at`,
  ).run(key, label, id, now);
}

export function listRecentPlayers(
  db: DatabaseSync = getDb(),
  limit = RECENT_PLAYERS_LIMIT,
): RecentPlayer[] {
  const capped = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : RECENT_PLAYERS_LIMIT;
  const rows = db
    .prepare(
      `SELECT recent.name, recent.person_id, recent.last_played_at, recent.group_started_at
       FROM (
         SELECT
           pp.label AS name,
           pp.person_id AS person_id,
           MAX(pa.updated_at) AS last_played_at,
           MAX(pa.started_at) AS group_started_at
         FROM party_presence pp
         JOIN parties pa ON pa.id = pp.party_id
         WHERE pa.status = 'closed'
           AND TRIM(pp.label) != ''
         GROUP BY lower(pp.label), COALESCE(pp.person_id, '')
       ) recent
       LEFT JOIN dismissed_recent_players d
         ON d.dismiss_key = lower(recent.name) || '|' || COALESCE(recent.person_id, '')
       WHERE d.dismiss_key IS NULL OR recent.last_played_at > d.dismissed_at
       ORDER BY recent.last_played_at DESC
       LIMIT ?`,
    )
    .all(capped) as Array<{
    name: string;
    person_id: string | null;
    last_played_at: string;
    group_started_at: string;
  }>;

  return rows.map((row) => ({
    name: row.name,
    personId: row.person_id,
    lastPlayedAt: row.last_played_at,
    groupStartedAt: row.group_started_at,
  }));
}
