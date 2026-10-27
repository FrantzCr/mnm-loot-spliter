"use client";

import { BanknoteArrowDown, BanknoteArrowUp, Scale } from "lucide-react";

import { CoinAmount } from "@/components/coin-amount";
import { useI18n } from "@/components/locale";
import type { BalanceRow } from "@/lib/split";
import { cn } from "cn";

/** Palette shared by the rail, the cards and the hold-vs-share bar. */
const TONE = {
  owe: "text-destructive",
  owed: "text-[#2f5d3a]",
  even: "text-muted-foreground",
} as const;

function tone(balance: number): keyof typeof TONE {
  if (balance > 0) return "owe";
  if (balance < 0) return "owed";
  return "even";
}

function pct(part: number, whole: number): number {
  if (!(whole > 0)) return 0;
  return Math.max(0, Math.min(100, (part / whole) * 100));
}

/**
 * Signed balance chip: "− 2s 36c" (gives) in red, "+ 4s 29c" (receives) in green, "even" otherwise.
 * `balance > 0` means the member holds more than their share and owes the difference.
 */
export function BalanceChip({ balance, size = "md" }: { balance: number; size?: "sm" | "md" | "lg" }) {
  const { copy } = useI18n();
  const kind = tone(balance);
  const Icon = kind === "owe" ? BanknoteArrowUp : kind === "owed" ? BanknoteArrowDown : Scale;
  const label =
    kind === "owe" ? copy.group.balanceGives : kind === "owed" ? copy.group.balanceReceives : copy.group.balanceEven;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap",
        size === "sm" && "px-1.5 py-0.5 text-xs",
        size === "md" && "px-2 py-0.5 text-sm",
        size === "lg" && "px-2.5 py-1 text-base",
        kind === "owe" && "border-destructive/40 bg-destructive/8",
        kind === "owed" && "border-[#2f5d3a]/40 bg-[#2f5d3a]/8",
        kind === "even" && "border-border bg-muted/40",
        TONE[kind],
      )}
    >
      <Icon className={size === "sm" ? "size-3.5" : "size-4"} aria-hidden />
      <span className="sr-only">{label}</span>
      {kind === "even" ? (
        <span>{label}</span>
      ) : (
        <>
          <span aria-hidden>{kind === "owe" ? "−" : "+"}</span>
          <CoinAmount copper={Math.abs(balance)} omitZeros />
        </>
      )}
    </span>
  );
}

/**
 * Horizontal hold-vs-share bar on a shared scale. The solid part is what both hold and share
 * agree on; red hatching is held above the share (to give), a dashed green slot is share not yet
 * held (to receive). A tick marks the fair share.
 */
export function HoldShareBar({
  held,
  share,
  scale,
  thick = false,
}: {
  held: number;
  share: number;
  /** Copper that maps to 100% of the track (shared across members so bars compare). */
  scale: number;
  thick?: boolean;
}) {
  const base = pct(Math.min(held, share), scale);
  const heldPct = pct(held, scale);
  const sharePct = pct(share, scale);
  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-sm bg-[#6e5338]/10",
        thick ? "h-4" : "h-2.5",
      )}
      aria-hidden
    >
      <div className="absolute inset-y-0 left-0 bg-[#6e5338]/75" style={{ width: `${base}%` }} />
      {held > share ? (
        <div
          className="absolute inset-y-0 bg-destructive/70 bg-[repeating-linear-gradient(135deg,transparent_0_3px,rgba(255,255,255,0.35)_3px_6px)]"
          style={{ left: `${sharePct}%`, width: `${heldPct - sharePct}%` }}
        />
      ) : null}
      {share > held ? (
        <div
          className="absolute inset-y-0 border border-dashed border-[#2f5d3a]/80 bg-[#2f5d3a]/12"
          style={{ left: `${heldPct}%`, width: `${sharePct - heldPct}%` }}
        />
      ) : null}
      {share > 0 ? (
        <div
          className="absolute -inset-y-px w-0.5 bg-foreground/80"
          style={{ left: `calc(${sharePct}% - 1px)` }}
        />
      ) : null}
    </div>
  );
}

/**
 * Left rail on Overview: every member with their share of the pot's item worth and how far that
 * sits from the fair share.
 */
export function MemberRail({ members, totalCopper }: { members: BalanceRow[]; totalCopper: number }) {
  const { copy } = useI18n();
  const ordered = [...members].sort((a, b) => {
    if ((a.leftAt == null) !== (b.leftAt == null)) return a.leftAt == null ? -1 : 1;
    return b.lootedCopper - a.lootedCopper;
  });
  return (
    <aside className="grid content-start gap-3 rounded-sm border border-[#6e5338]/45 bg-card p-3 lg:sticky lg:top-4">
      <div className="grid gap-0.5">
        <h3 className="font-heading text-base">{copy.group.railTitle}</h3>
        <p className="text-xs text-muted-foreground">
          {copy.group.railTotal} <CoinAmount copper={totalCopper} omitZeros />
        </p>
      </div>
      {ordered.length === 0 ? (
        <p className="text-sm text-muted-foreground">{copy.group.railEmpty}</p>
      ) : (
        <ul className="grid gap-3">
          {ordered.map((row) => {
            const heldShare = Math.round(pct(row.lootedCopper, totalCopper));
            const fairShare = Math.round(pct(row.shareCopper, totalCopper));
            return (
              <li key={row.key} className={cn("grid gap-1", row.leftAt ? "opacity-55" : undefined)}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-heading text-sm">{row.name}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {copy.group.railPercent(heldShare, fairShare)}
                  </span>
                </div>
                <HoldShareBar held={row.lootedCopper} share={row.shareCopper} scale={totalCopper} />
                <div className="flex justify-end">
                  <BalanceChip balance={row.balanceCopper} size="sm" />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <RailLegend />
    </aside>
  );
}

function RailLegend() {
  const { copy } = useI18n();
  return (
    <div className="grid gap-1 border-t border-border pt-2 text-[0.6875rem] text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2 w-3 rounded-[1px] bg-[#6e5338]/75" /> {copy.group.legendHeld}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-0.5 bg-foreground/80" /> {copy.group.legendShare}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2 w-3 rounded-[1px] bg-destructive/70" /> {copy.group.legendOver}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-2 w-3 rounded-[1px] border border-dashed border-[#2f5d3a]/80 bg-[#2f5d3a]/12" />{" "}
        {copy.group.legendUnder}
      </span>
    </div>
  );
}

/** Large per-player recap: name, signed balance, hold-vs-share bar and the two amounts. */
export function PlayerRecapCard({ row, scale }: { row: BalanceRow; scale: number }) {
  const { copy } = useI18n();
  const kind = tone(row.balanceCopper);
  return (
    <li
      className={cn(
        "grid gap-3 rounded-sm border-2 bg-card p-4",
        kind === "owe" && "border-destructive/35",
        kind === "owed" && "border-[#2f5d3a]/35",
        kind === "even" && "border-[#6e5338]/25",
        row.leftAt ? "opacity-70" : undefined,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-heading text-xl">{row.name}</span>
        <BalanceChip balance={row.balanceCopper} size="lg" />
      </div>
      <HoldShareBar held={row.lootedCopper} share={row.shareCopper} scale={scale} thick />
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div className="grid gap-0.5">
          <dt className="text-xs text-muted-foreground">{copy.group.inHand}</dt>
          <dd className="font-medium">
            <CoinAmount copper={row.lootedCopper} omitZeros />
          </dd>
        </div>
        <div className="grid gap-0.5 text-right">
          <dt className="text-xs text-muted-foreground">{copy.group.share}</dt>
          <dd className="font-medium">
            <CoinAmount copper={row.shareCopper} omitZeros />
          </dd>
        </div>
      </dl>
    </li>
  );
}
