import { itemKey } from "./format";
import { isPoolOnlyLine, type PotLine } from "./split";

function stackBy<T extends { quantity: number }>(
  lines: T[],
  keyOf: (line: T) => string,
  merge: (into: T, line: T) => void,
): T[] {
  const order: string[] = [];
  const grouped = new Map<string, T>();
  for (const line of lines) {
    const key = keyOf(line);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...line });
      order.push(key);
      continue;
    }
    merge(existing, line);
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

/**
 * Display aggregation for the All loot tab.
 * Same item (+ unit price) stacks across holders; corpse coins sum into one pool row.
 * Holder names are joined when several people contributed.
 */
export function stackLootLinesAcrossPeople(lines: PotLine[]): PotLine[] {
  return stackBy(
    lines,
    (line) => {
      if (isPoolOnlyLine(line)) return itemKey(line.itemName);
      return `${itemKey(line.itemName)}\0${line.unitCopper ?? ""}`;
    },
    (into, line) => {
      mergeHolderLabel(into, line);
      if (isPoolOnlyLine(into)) {
        into.unitCopper = lineCopper(into) + lineCopper(line);
        into.quantity = 1;
        return;
      }
      into.quantity += line.quantity;
    },
  );
}
