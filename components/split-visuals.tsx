"use client";

import type { ReactNode } from "react";

import { CoinAmount, coinColumnsFor } from "@/components/coin-amount";
import { useI18n } from "@/components/locale";
import type { BalanceRow } from "@/lib/split";
import { cn } from "cn";

// `balanceCopper > 0`: holds more than the fair share → gives. `< 0`: holds less → receives.
const GIVE = "text-[#9a2f1f]";
/** Panel amounts keep the 3 largest denominations (exact up to gold; platinum rounds to silver). */
const RAIL_DENOMINATIONS = 3;
const RECEIVE = "text-[#2f5d3a]";

/**
 * Overview members panel: one tight row per member, a bar centred on the fair share that grows
 * left (red, gives) or right (green, receives) in proportion to the amount. Sorted from the
 * biggest giver to the biggest receiver so the shape reads at a glance. Nothing to click on a
 * row: `rowNote` adds exceptions (late join, left, different share) next to the held value and
 * `rowActions` are icon buttons right of the amount; `children` render under the list.
 */
export function MemberRail({
  members,
  totalCopper,
  subtitle,
  rowNote,
  rowActions,
  selectedKey = null,
  onSelect,
  selectLabel,
  children,
}: {
  members: BalanceRow[];
  totalCopper: number;
  subtitle?: ReactNode;
  rowNote?: (row: BalanceRow) => string | null;
  rowActions?: (row: BalanceRow) => ReactNode;
  /** Highlighted row (e.g. the member the Loot list is filtered on). */
  selectedKey?: string | null;
  /** Clicking a row's bar/amount; rows where it returns nothing useful should be excluded via `canSelect`. */
  onSelect?: { canSelect: (row: BalanceRow) => boolean; select: (row: BalanceRow) => void };
  /** Accessible label for a selectable row, e.g. "Show Yme's loot". */
  selectLabel?: (row: BalanceRow) => string;
  children?: ReactNode;
}) {
  const { copy } = useI18n();
  const ordered = [...members].sort((a, b) => b.balanceCopper - a.balanceCopper);
  const maxAbs = Math.max(1, ...ordered.map((row) => Math.abs(row.balanceCopper)));
  // Same coin columns on every row so icons line up; at most 3 so platinum amounts still fit.
  const coinColumns = coinColumnsFor(
    ordered.map((row) => row.balanceCopper),
    RAIL_DENOMINATIONS,
  );
  return (
    <aside className="grid content-start gap-2 rounded-sm border border-[#6e5338]/45 bg-card px-3 py-2.5 lg:sticky lg:top-4">
      <div className="grid gap-0.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2">
          <h3 className="font-heading text-base">{copy.group.railTitle}</h3>
          <span className="text-xs text-muted-foreground">
            {copy.group.railTotal} <CoinAmount copper={totalCopper} omitZeros significant={RAIL_DENOMINATIONS} />
          </span>
        </div>
        {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>
      {ordered.length === 0 ? (
        <p className="text-sm text-muted-foreground">{copy.group.railEmpty}</p>
      ) : (
        <div className="grid grid-cols-[minmax(9.5rem,1fr)_auto_auto_auto] items-center gap-x-1 text-sm sm:gap-x-1.5">
          {ordered.map((row) => {
            const width = (Math.abs(row.balanceCopper) / maxAbs) * 50;
            const gives = row.balanceCopper > 0;
            const note = rowNote?.(row) ?? null;
            const selectable = onSelect?.canSelect(row) ?? false;
            const selected = selectedKey === row.key;
            const Main = selectable ? "button" : "span";
            return (
              <div
                key={row.key}
                className={cn(
                  "col-span-4 -mx-1.5 grid grid-cols-subgrid items-center rounded-sm px-1.5",
                  selectable && "transition-colors hover:bg-[#efe6d6]/70",
                  selected && "bg-[#efe6d6] shadow-[inset_3px_0_0_#6e5338] hover:bg-[#efe6d6]",
                )}
              >
                <Main
                  {...(selectable
                    ? {
                        type: "button" as const,
                        "aria-pressed": selected,
                        title: selectLabel?.(row),
                        onClick: () => onSelect?.select(row),
                      }
                    : {})}
                  className={cn(
                    "col-span-3 grid grid-cols-subgrid items-center rounded-sm text-left",
                    selectable &&
                      "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[#7a4503]/40",
                    row.leftAt ? "[&>*]:opacity-55" : undefined,
                  )}
                >
                {/* Name sits against the axis on the side the bar does not use, so it never overlaps. */}
                <span className="relative h-10">
                  <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-foreground/25" aria-hidden />
                  {row.balanceCopper !== 0 ? (
                    <span
                      aria-hidden
                      className={cn(
                        "absolute inset-y-1.5 min-w-[3px]",
                        // Surplus over the fair share grows right, shortfall grows left.
                        gives ? "left-1/2 rounded-r-[3px] bg-[#c9a227]/55" : "right-1/2 rounded-l-[3px] bg-[#c9a227]/55",
                      )}
                      style={{ width: `${width}%` }}
                    />
                  ) : null}
                  {/* Name with the item value they hold (and any exception) just under it. */}
                  <span
                    className={cn(
                      "absolute top-1/2 grid max-w-[calc(50%-0.5rem)] -translate-y-1/2 gap-0.5",
                      gives ? "right-[calc(50%+0.4rem)] justify-items-end text-right" : "left-[calc(50%+0.4rem)] justify-items-start",
                    )}
                  >
                    <span className="max-w-full truncate font-heading text-[0.9375rem] leading-none text-foreground/90 [-webkit-text-stroke:0.15px_currentColor]">
                      {row.name}
                    </span>
                    <span className="max-w-full truncate text-[0.625rem] leading-none text-muted-foreground sm:text-[0.6875rem]" title={note ?? undefined}>
                      <span className="sr-only">{copy.group.inHand} </span>
                      <CoinAmount copper={row.lootedCopper} omitZeros significant={RAIL_DENOMINATIONS} />
                      {note ? <span className="italic"> · {note}</span> : null}
                    </span>
                  </span>
                </span>
                {row.balanceCopper === 0 ? (
                  <span className="col-span-2 justify-self-end text-muted-foreground">{copy.group.balanceEven}</span>
                ) : (
                  <>
                    {/* Sign reads from the member's side: + surplus over the share, − missing. */}
                    <span aria-hidden className={cn("font-mono opacity-80", gives ? RECEIVE : GIVE)}>
                      {gives ? "+" : "−"}
                    </span>
                    <span className={cn("justify-self-end opacity-80", gives ? RECEIVE : GIVE)}>
                      <span className="sr-only">{gives ? copy.group.balanceGives : copy.group.balanceReceives}</span>
                      <CoinAmount copper={Math.abs(row.balanceCopper)} columns={coinColumns} />
                    </span>
                  </>
                )}
                </Main>
                <span className="flex items-center justify-end">{rowActions?.(row)}</span>
              </div>
            );
          })}
        </div>
      )}
      {children ? <div className="grid gap-3 border-t border-border pt-3">{children}</div> : null}
    </aside>
  );
}

/** Small square icon button for member row actions (settle, leave). Hidden slot keeps alignment. */
export function RowIconButton({
  label,
  hidden = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  hidden?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-hidden={hidden || undefined}
      tabIndex={hidden ? -1 : undefined}
      disabled={disabled || hidden}
      onClick={onClick}
      className={cn(
        "inline-flex size-5 items-center justify-center rounded-sm sm:size-6 text-foreground/65 outline-none transition-colors hover:bg-[#6e5338]/12 hover:text-foreground focus-visible:ring-2 focus-visible:ring-[#7a4503]/40 disabled:pointer-events-none",
        hidden && "invisible",
      )}
    >
      {children}
    </button>
  );
}
