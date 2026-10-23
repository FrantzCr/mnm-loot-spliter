import { itemKey } from "./format";
import { COIN_LOOT_ITEM_NAME } from "./ledger-parse";

export type SplitMode = "items" | "value";

export type PotLine = {
  id: string;
  itemName: string;
  quantity: number;
  unitCopper: number | null;
  lootedAt: string;
  personId: string;
  personName: string;
};

/**
 * Corpse coins (act_14): the game already auto-splits them among party members.
 * They count in session coin totals only — not in "already holding" / fair share /
 * settle math (those are item loot only).
 */
export function isPoolOnlyLine(line: Pick<PotLine, "itemName">): boolean {
  return itemKey(line.itemName) === itemKey(COIN_LOOT_ITEM_NAME);
}

export type PresenceWindow = {
  id: string;
  personId: string | null;
  name: string;
  joinedAt: string;
  leftAt: string | null;
};

export type RecordedSettlement = {
  fromPresenceId: string;
  toPresenceId: string;
  copper: number;
};

export type BalanceRow = {
  key: string;
  name: string;
  personId: string | null;
  lootedCopper: number;
  shareCopper: number;
  balanceCopper: number;
  joinedAt: string | null;
  leftAt: string | null;
};

export type Transfer = {
  from: string;
  to: string;
  fromPresenceId: string;
  toPresenceId: string;
  copper: number;
};

export type ItemAssignment = {
  key: string;
  name: string;
  personId: string | null;
  copper: number;
  lines: Array<{
    id: string;
    itemName: string;
    quantity: number;
    copper: number;
    priced: boolean;
    lootedBy: string;
  }>;
};

export type UnpricedPotLine = {
  itemName: string;
  quantity: number;
  personName: string;
};

export type SplitComputation = {
  mode: SplitMode;
  headcount: number;
  /** All priced pot lines (items + corpse coins). */
  totalCopper: number;
  /** Priced non-coin loot only (what the group “earned” as items). */
  lootCopper: number;
  /** Corpse coins already auto-split in-game. */
  splitCoinCopper: number;
  unpricedCount: number;
  unpricedLines: UnpricedPotLine[];
  balances: BalanceRow[];
  transfers: Transfer[];
  settled: Transfer[];
  piles: ItemAssignment[];
};

export function lineValue(line: PotLine): number | null {
  if (line.unitCopper == null) return null;
  return line.quantity * line.unitCopper;
}

/** Priced pot totals: item loot vs corpse coins (already split in-game). */
export function potSessionTotals(lines: PotLine[]): {
  totalCopper: number;
  lootCopper: number;
  splitCoinCopper: number;
  unpricedLines: UnpricedPotLine[];
} {
  let totalCopper = 0;
  let lootCopper = 0;
  let splitCoinCopper = 0;
  const unpricedLines: UnpricedPotLine[] = [];
  for (const line of lines) {
    const value = lineValue(line);
    if (value == null) {
      unpricedLines.push({
        itemName: line.itemName,
        quantity: line.quantity,
        personName: line.personName,
      });
      continue;
    }
    totalCopper += value;
    if (isPoolOnlyLine(line)) splitCoinCopper += value;
    else lootCopper += value;
  }
  return { totalCopper, lootCopper, splitCoinCopper, unpricedLines };
}

export function splitPot(
  lines: PotLine[],
  presences: PresenceWindow[],
  mode: SplitMode,
  settlements: RecordedSettlement[] = [],
): SplitComputation {
  const { totalCopper, lootCopper, splitCoinCopper, unpricedLines } = potSessionTotals(lines);
  const unpricedCount = unpricedLines.length;
  const balances = valueBalances(lines, presences, settlements);
  const settled = settlements.flatMap((payment) => {
    const from = presences.find((presence) => presence.id === payment.fromPresenceId);
    const to = presences.find((presence) => presence.id === payment.toPresenceId);
    if (!from || !to || payment.copper <= 0) return [];
    return [
      {
        from: from.name,
        to: to.name,
        fromPresenceId: from.id,
        toPresenceId: to.id,
        copper: payment.copper,
      },
    ];
  });
  return {
    mode,
    headcount: presences.length,
    totalCopper,
    lootCopper,
    splitCoinCopper,
    unpricedCount,
    unpricedLines,
    balances,
    transfers: mode === "value" ? settleEveryone(balances) : [],
    settled: mode === "value" ? settled : [],
    piles: mode === "items" ? assignItems(lines, presences) : [],
  };
}

export function settlePresence(rows: BalanceRow[], presenceId: string): Transfer[] {
  const subject = rows.find((row) => row.key === presenceId);
  if (!subject || subject.balanceCopper === 0 || !subject.joinedAt) return [];
  const transfers: Transfer[] = [];
  if (subject.balanceCopper > 0) {
    let left = subject.balanceCopper;
    const creditors = rows
      .filter((row) => row.key !== presenceId && row.balanceCopper < 0 && row.joinedAt)
      .map((row) => ({ row, left: -row.balanceCopper }))
      .sort((a, b) => b.left - a.left);
    for (const creditor of creditors) {
      if (left === 0) break;
      const pay = Math.min(left, creditor.left);
      transfers.push({
        from: subject.name,
        to: creditor.row.name,
        fromPresenceId: subject.key,
        toPresenceId: creditor.row.key,
        copper: pay,
      });
      left -= pay;
    }
    return transfers;
  }
  let left = -subject.balanceCopper;
  const debtors = rows
    .filter((row) => row.key !== presenceId && row.balanceCopper > 0 && row.joinedAt)
    .map((row) => ({ row, left: row.balanceCopper }))
    .sort((a, b) => b.left - a.left);
  for (const debtor of debtors) {
    if (left === 0) break;
    const pay = Math.min(left, debtor.left);
    transfers.push({
      from: debtor.row.name,
      to: subject.name,
      fromPresenceId: debtor.row.key,
      toPresenceId: subject.key,
      copper: pay,
    });
    left -= pay;
  }
  return transfers;
}

function valueBalances(
  lines: PotLine[],
  presences: PresenceWindow[],
  settlements: RecordedSettlement[],
): BalanceRow[] {
  const rows = new Map<string, BalanceRow>();
  for (const presence of [...presences].sort(bySeat)) {
    rows.set(presence.id, {
      key: presence.id,
      name: presence.name,
      personId: presence.personId,
      lootedCopper: 0,
      shareCopper: 0,
      balanceCopper: 0,
      joinedAt: presence.joinedAt,
      leftAt: presence.leftAt,
    });
  }

  const outsiders = new Map<string, BalanceRow>();
  for (const line of lines) {
    const value = lineValue(line);
    if (value == null) continue;
    // Corpse coins: already split in-game — skip holds / fair share / settle.
    if (isPoolOnlyLine(line)) continue;
    const holders = presences.filter((presence) => presentAt(presence, line.lootedAt)).sort(bySeat);
    const holder = findLineHolder(holders, line);
    if (holder) {
      const row = rows.get(holder.id);
      if (row) row.lootedCopper += value;
    } else {
      const current = outsiders.get(line.personId) ?? {
        key: line.personId,
        name: line.personName,
        personId: line.personId,
        lootedCopper: 0,
        shareCopper: 0,
        balanceCopper: 0,
        joinedAt: null,
        leftAt: null,
      };
      current.lootedCopper += value;
      outsiders.set(line.personId, current);
    }
    if (holders.length === 0) continue;
    const base = Math.floor(value / holders.length);
    const remainder = value % holders.length;
    holders.forEach((presence, index) => {
      const row = rows.get(presence.id);
      if (!row) return;
      row.shareCopper += base + (index < remainder ? 1 : 0);
    });
  }

  const balances = [...rows.values(), ...outsiders.values()];
  for (const row of balances) row.balanceCopper = row.lootedCopper - row.shareCopper;
  for (const payment of settlements) {
    const from = rows.get(payment.fromPresenceId);
    const to = rows.get(payment.toPresenceId);
    if (from) from.balanceCopper -= payment.copper;
    if (to) to.balanceCopper += payment.copper;
  }
  return balances;
}

/** Group members for the settlement recap — omits out-of-split loot holders. */
export function settlementMembers(rows: BalanceRow[]): BalanceRow[] {
  return rows.filter((row) => row.joinedAt != null);
}

/** Same transfers as the value-split "who pays whom" preview. */
export function settleEveryone(rows: BalanceRow[]): Transfer[] {
  const debtors = rows
    .filter((row) => row.balanceCopper > 0 && row.joinedAt)
    .map((row) => ({ row, left: row.balanceCopper }));
  const creditors = rows
    .filter((row) => row.balanceCopper < 0 && row.joinedAt)
    .map((row) => ({ row, left: -row.balanceCopper }));
  debtors.sort((a, b) => b.left - a.left);
  creditors.sort((a, b) => b.left - a.left);
  const transfers: Transfer[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;
  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const pay = Math.min(debtors[debtorIndex].left, creditors[creditorIndex].left);
    if (pay > 0) {
      transfers.push({
        from: debtors[debtorIndex].row.name,
        to: creditors[creditorIndex].row.name,
        fromPresenceId: debtors[debtorIndex].row.key,
        toPresenceId: creditors[creditorIndex].row.key,
        copper: pay,
      });
    }
    debtors[debtorIndex].left -= pay;
    creditors[creditorIndex].left -= pay;
    if (debtors[debtorIndex].left === 0) debtorIndex += 1;
    if (creditors[creditorIndex].left === 0) creditorIndex += 1;
  }
  return transfers;
}

function assignItems(lines: PotLine[], presences: PresenceWindow[]): ItemAssignment[] {
  const piles = new Map<string, ItemAssignment>();
  for (const presence of [...presences].sort(bySeat)) {
    piles.set(presence.id, {
      key: presence.id,
      name: presence.name,
      personId: presence.personId,
      copper: 0,
      lines: [],
    });
  }
  const outside: ItemAssignment = {
    key: "outside",
    name: "Hors partage",
    personId: null,
    copper: 0,
    lines: [],
  };
  const ordered = [...lines]
    .filter((line) => !isPoolOnlyLine(line))
    .sort((a, b) => (lineValue(b) ?? -1) - (lineValue(a) ?? -1));
  for (const line of ordered) {
    const holders = presences.filter((presence) => presentAt(presence, line.lootedAt)).sort(bySeat);
    let target = outside;
    if (holders.length > 0) {
      let chosen = holders[0];
      for (const holder of holders) {
        const pile = piles.get(holder.id);
        const best = chosen ? piles.get(chosen.id) : undefined;
        if (pile && best && pile.copper < best.copper) chosen = holder;
      }
      target = (chosen && piles.get(chosen.id)) || outside;
    }
    const value = lineValue(line);
    target.lines.push({
      id: line.id,
      itemName: line.itemName,
      quantity: line.quantity,
      copper: value ?? 0,
      priced: value != null,
      lootedBy: line.personName,
    });
    target.copper += value ?? 0;
  }
  const result = [...piles.values()];
  if (outside.lines.length > 0) result.push(outside);
  return result;
}

/**
 * Prefer personId. Party seats often join as labels (personId null) or with a stale
 * link while loot lines carry a people UUID — fall back to normalized name so
 * valued items stay on the holder. Otherwise holds look like coin autosplit only
 * and everyone appears "owed".
 */
function findLineHolder(holders: PresenceWindow[], line: PotLine): PresenceWindow | undefined {
  const byId = holders.find((presence) => presence.personId != null && presence.personId === line.personId);
  if (byId) return byId;
  const name = itemKey(line.personName);
  const unlabeled = holders.find((presence) => presence.personId == null && itemKey(presence.name) === name);
  if (unlabeled) return unlabeled;
  return holders.find((presence) => itemKey(presence.name) === name);
}

function presentAt(presence: PresenceWindow, at: string): boolean {
  const time = timeValue(at);
  if (time < timeValue(presence.joinedAt)) return false;
  if (presence.leftAt == null) return true;
  return time < timeValue(presence.leftAt);
}

function bySeat(a: PresenceWindow, b: PresenceWindow): number {
  const joined = timeValue(a.joinedAt) - timeValue(b.joinedAt);
  if (joined !== 0) return joined;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

function timeValue(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}
