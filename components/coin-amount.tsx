"use client";

import { Fragment, type ReactNode } from "react";

import { useI18n } from "@/components/locale";
import {
  COPPER_PER_GOLD,
  COPPER_PER_PLATINUM,
  COPPER_PER_SILVER,
  copperToCoins,
  formatCoins,
  type CoinParts,
} from "@/lib/money";
import { cn } from "cn";

/** Passed into copy strings so a coin row can replace the amount words. */
export const COIN_SLOT = "\u0001";

const ORDER = ["platinum", "gold", "silver", "copper"] as const;

export type CoinKey = (typeof ORDER)[number];

/**
 * Shared columns for a list of amounts: from the largest denomination any of them uses down to
 * copper. Pass the result as `columns` to every row so icons line up whatever the value.
 */
export function coinColumnsFor(amounts: number[], max: number = ORDER.length): CoinKey[] {
  let first = ORDER.length - 1;
  for (const amount of amounts) {
    const parts = copperToCoins(Math.abs(Number.isFinite(amount) ? amount : 0));
    const index = ORDER.findIndex((key) => parts[key] !== 0);
    if (index >= 0 && index < first) first = index;
  }
  return ORDER.slice(first, first + max);
}

const UNIT: Record<CoinKey, number> = {
  platinum: COPPER_PER_PLATINUM,
  gold: COPPER_PER_GOLD,
  silver: COPPER_PER_SILVER,
  copper: 1,
};

/** Round to the smallest of the given denominations (columns that drop copper round to silver, …). */
function roundToColumns(amount: number, columns: CoinKey[]): number {
  const smallest = columns[columns.length - 1];
  if (!smallest) return amount;
  const unit = UNIT[smallest];
  return Math.sign(amount) * Math.round(Math.abs(amount) / unit) * unit;
}

/** Keep only the `count` most significant denominations of one amount (rounded). */
function roundToSignificant(amount: number, count: number): number {
  return roundToColumns(amount, coinColumnsFor([amount], count));
}

/** Space between each coin-and-number pair. Icon-to-digit spacing stays tighter. */
const PAIR_GAP = "gap-[6px]";

const COIN_PAINT = {
  platinum: { fill: "#f3efe6", edge: "#6f6a64" },
  gold: { fill: "#e2b340", edge: "#7a5810" },
  silver: { fill: "#c5c9cf", edge: "#5c636c" },
  copper: { fill: "#c86b34", edge: "#6e3816" },
} as const;

function CoinMark({
  paint,
  muted,
}: {
  paint: (typeof COIN_PAINT)[keyof typeof COIN_PAINT];
  muted?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      className="inline-block size-[1em] shrink-0"
      aria-hidden="true"
    >
      <circle
        cx="8"
        cy="8"
        r="6.15"
        fill={paint.fill}
        stroke={paint.edge}
        strokeWidth="1.35"
        fillOpacity={muted ? 0.28 : 1}
        strokeOpacity={muted ? 0.7 : 1}
        strokeDasharray={muted ? "2.2 1.7" : undefined}
      />
      <circle
        cx="8"
        cy="8"
        r="4.15"
        fill="none"
        stroke={paint.edge}
        strokeWidth="0.65"
        opacity={muted ? 0.35 : 0.55}
        strokeDasharray={muted ? "1.4 1.5" : undefined}
      />
    </svg>
  );
}

function coinsToShow(parts: CoinParts, omitZeros: boolean): Array<(typeof ORDER)[number]> {
  if (!omitZeros) return [...ORDER];
  const present = ORDER.filter((key) => parts[key] !== 0);
  return present.length > 0 ? present : ["copper"];
}

/** Fixed strip so platinum/gold/silver/copper icons share one column across sibling rows. */
const ALIGNED_STRIP =
  "inline-grid w-[12.5rem] shrink-0 grid-cols-4 items-center justify-items-start gap-x-1.5";

function CoinRow({
  parts,
  muted,
  negative,
  omitZeros = false,
  aligned = false,
  columns,
}: {
  parts: CoinParts;
  muted?: boolean;
  negative?: boolean;
  omitZeros?: boolean;
  /** Four fixed columns — icons line up even when digit counts differ (6 vs 66). */
  aligned?: boolean;
  /** Fixed subset of columns (see `coinColumnsFor`); a zero denomination keeps its slot, blank. */
  columns?: CoinKey[];
}) {
  if (columns) {
    return (
      <span aria-hidden="true" className={cn("inline-flex items-center", PAIR_GAP, muted && "opacity-80")}>
        {negative ? <span className="leading-none">−</span> : null}
        {columns.map((key) => (
          <span
            key={key}
            className={cn("inline-flex items-center justify-end gap-0.5 leading-none", parts[key] === 0 && "invisible")}
          >
            <CoinMark paint={COIN_PAINT[key]} muted={muted} />
            <span className="min-w-[2ch] text-right tabular-nums">{parts[key]}</span>
          </span>
        ))}
      </span>
    );
  }
  if (aligned) {
    return (
      <span
        aria-hidden="true"
        className={cn("inline-flex items-center gap-1", muted && "opacity-80")}
      >
        {negative ? <span className="leading-none">−</span> : null}
        <span className={ALIGNED_STRIP}>
          {ORDER.map((key) => (
            <span key={key} className="inline-flex min-w-0 items-center gap-0.5 leading-none">
              <CoinMark paint={COIN_PAINT[key]} muted={muted} />
              <span className="min-w-[2.5ch] text-right tabular-nums">{parts[key]}</span>
            </span>
          ))}
        </span>
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex flex-nowrap items-center", PAIR_GAP, muted && "opacity-80")}
    >
      {negative ? <span className="leading-none">−</span> : null}
      {coinsToShow(parts, omitZeros).map((key) => (
        <span key={key} className="inline-flex items-center gap-0.5 leading-none">
          <CoinMark paint={COIN_PAINT[key]} muted={muted} />
          <span>{parts[key]}</span>
        </span>
      ))}
    </span>
  );
}

export function CoinAmount({
  copper,
  className,
  omitZeros = false,
  aligned = false,
  columns,
  significant,
}: {
  copper: number;
  className?: string;
  /** Show at most this many denominations from the largest (rounded); for tight panels. */
  significant?: number;
  /** Drop denominations whose count is 0. A zero amount still shows copper. Ignored when `aligned`. */
  omitZeros?: boolean;
  /** Fixed four-column strip for vertical icon alignment in lists. */
  aligned?: boolean;
  /** Compact alignment: only these denominations, shared across sibling rows (`coinColumnsFor`). */
  columns?: CoinKey[];
}) {
  const { locale } = useI18n();
  // Missing/NaN amounts render as 0 copper, not an em dash (formatCoins uses "—" for non-finite).
  const exact = Number.isFinite(copper) ? copper : 0;
  // Tight layouts trade the smallest coins for width; the accessible label stays exact.
  const amount = columns
    ? roundToColumns(exact, columns)
    : significant
      ? roundToSignificant(exact, significant)
      : exact;
  const label = formatCoins(exact, locale);

  return (
    <span
      className={cn(
        // Inherit size from prose; mono keeps digits clear. Sink the whole strip to match serif prose.
        "inline-flex translate-y-[0.12em] items-center align-baseline font-mono text-[1em] font-medium leading-none whitespace-nowrap tabular-nums",
        className,
      )}
      role="img"
      aria-label={label}
      data-coins=""
    >
      <CoinRow
        parts={copperToCoins(amount)}
        negative={amount < 0}
        omitZeros={aligned ? false : omitZeros}
        aligned={aligned}
        columns={columns}
      />
    </span>
  );
}

/** Unpriced loot: the same four coins, dashed and quiet, with counts at 0. */
export function UnknownPrice({ className }: { className?: string }) {
  const { copy } = useI18n();
  return (
    <span
      className={cn(
        "inline-flex translate-y-[0.12em] flex-nowrap items-center align-baseline font-mono text-[1em] font-normal leading-none whitespace-nowrap text-muted-foreground tabular-nums",
        PAIR_GAP,
        className,
      )}
      data-coins=""
    >
      <CoinRow parts={{ platinum: 0, gold: 0, silver: 0, copper: 0 }} muted />
      <span>{copy.common.unknownPrice}</span>
    </span>
  );
}

export function CoinPhrase({
  text,
  amounts,
  omitZeros,
  amountClassName,
}: {
  text: string;
  amounts: number[];
  /** When set, the amount at that index drops zero denominations. */
  omitZeros?: boolean[];
  amountClassName?: string;
}): ReactNode {
  const parts = text.split(COIN_SLOT);
  return parts.map((part, index) => {
    const amount =
      index < amounts.length ? (
        <CoinAmount
          copper={amounts[index] ?? 0}
          omitZeros={omitZeros?.[index]}
          className={amountClassName}
        />
      ) : null;
    return (
      <Fragment key={index}>
        {part}
        {amount}
      </Fragment>
    );
  });
}
