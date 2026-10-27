import { itemKey } from "./format";
import { isPoolOnlyLine, type PotLine } from "./split";

function stackBy<T extends { quantity: number; lootedAt: string }>(
  lines: T[],
  keyOf: (line: T) => string,
  merge: (into: T, line: T) => void,
  seed?: (line: T) => T,
): T[] {
  const order: string[] = [];
  const grouped = new Map<string, T>();
  for (const line of lines) {
    const key = keyOf(line);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, seed ? seed(line) : { ...line });
      order.push(key);
      continue;
    }
    merge(existing, line);
    // A stacked row is as recent as its latest pickup (display sort "newest first").
    if (line.lootedAt > existing.lootedAt) existing.lootedAt = line.lootedAt;
  }
  return order.map((key) => grouped.get(key) as T);
}

function lineCopper(line: Pick<PotLine, "quantity" | "unitCopper">): number {
  if (line.unitCopper == null) return 0;
  return line.quantity * line.unitCopper;
}

function mergeHolderLabel(into: PotLine, line: PotLine) {
  if (into.personId === line.personId) return;
  const names = new Set(
    into.personName
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
  );
  if (!names.has(line.personName)) {
    into.personName = `${into.personName}, ${line.personName}`;
  }
}

/**
 * Display aggregation for per-person loot tabs.
 * Same item + holder (+ unit price for priced goods) stacks quantity.
 * Corpse coins (pool-only) merge per holder and sum copper into unitCopper.
 * Does not alter lines used by split math.
 */
export function stackLootLines(lines: PotLine[]): PotLine[] {
  return stackBy(
    lines,
    (line) => {
      if (isPoolOnlyLine(line)) return `${itemKey(line.itemName)}\0${line.personId}`;
      return `${itemKey(line.itemName)}\0${line.personId}\0${line.unitCopper ?? ""}`;
    },
    (into, line) => {
      if (isPoolOnlyLine(into)) {
        into.unitCopper = lineCopper(into) + lineCopper(line);
        into.quantity = 1;
        return;
      }
      into.quantity += line.quantity;
    },
  );
}

/** One person's contribution inside an All-tab stacked row. */
export type LootHolderShare = {
  personId: string;
  personName: string;
  quantity: number;
  /** Priced copper for this holder; 0 when unpriced. */
  copper: number;
};

export type StackedAcrossPeopleLine = PotLine & {
  holders: LootHolderShare[];
};

function holderShareFromLine(line: PotLine): LootHolderShare {
  const pool = isPoolOnlyLine(line);
  return {
    personId: line.personId,
    personName: line.personName,
    quantity: pool ? 1 : line.quantity,
    copper: pool ? (line.unitCopper ?? 0) : lineCopper(line),
  };
}

function mergeHolderShare(into: StackedAcrossPeopleLine, line: PotLine) {
  const pool = isPoolOnlyLine(line);
  const existing = into.holders.find((holder) => holder.personId === line.personId);
  if (existing) {
    if (pool) {
      existing.copper += line.unitCopper ?? 0;
      return;
    }
    existing.quantity += line.quantity;
    existing.copper += lineCopper(line);
    return;
  }
  into.holders.push(holderShareFromLine(line));
}

/**
 * Display aggregation for the All loot tab.
 * Same item (+ unit price) stacks across holders; corpse coins sum into one pool row.
 * Holder names are joined when several people contributed; `holders` keeps each share.
 */
export function stackLootLinesAcrossPeople(lines: PotLine[]): StackedAcrossPeopleLine[] {
  return stackBy(
    lines as StackedAcrossPeopleLine[],
    (line) => {
      if (isPoolOnlyLine(line)) return itemKey(line.itemName);
      return `${itemKey(line.itemName)}\0${line.unitCopper ?? ""}`;
    },
    (into, line) => {
      mergeHolderLabel(into, line);
      mergeHolderShare(into, line);
      if (isPoolOnlyLine(into)) {
        into.unitCopper = lineCopper(into) + lineCopper(line);
        into.quantity = 1;
        return;
      }
      into.quantity += line.quantity;
    },
    (line) => ({
      ...line,
      holders: [holderShareFromLine(line)],
    }),
  );
}

export type LootSortMode = "recent" | "value";

/**
 * Display order for loot lists. Corpse coins always lead (they are not items). Then either newest
 * pickup first, or cheapest line value first with unpriced lines last. Ties keep input order.
 */
export function sortLootForDisplay<T extends PotLine>(lines: T[], mode: LootSortMode): T[] {
  const rank = (line: T) => (isPoolOnlyLine(line) ? 0 : 1);
  return lines
    .map((line, index) => ({ line, index }))
    .sort((a, b) => {
      const byPool = rank(a.line) - rank(b.line);
      if (byPool !== 0) return byPool;
      if (mode === "recent") {
        if (a.line.lootedAt !== b.line.lootedAt) return a.line.lootedAt < b.line.lootedAt ? 1 : -1;
        return a.index - b.index;
      }
      const av = a.line.unitCopper == null ? null : lineCopper(a.line);
      const bv = b.line.unitCopper == null ? null : lineCopper(b.line);
      if (av == null || bv == null) {
        if (av == null && bv == null) return a.index - b.index;
        return av == null ? 1 : -1;
      }
      return av - bv || a.index - b.index;
    })
    .map(({ line }) => line);
}
