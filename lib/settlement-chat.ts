import {
  COPPER_PER_GOLD,
  COPPER_PER_PLATINUM,
  COPPER_PER_SILVER,
  copperToCoins,
} from "@/lib/money";
import type { Transfer } from "@/lib/split";

/**
 * Conservative single-line limit for MnM group/say chat (no newlines).
 * Official docs do not publish a hard cap; stay under common classic-MMO limits.
 */
export const GAME_CHAT_MAX = 240;

/** Default: round tips to the nearest silver (100 copper). */
export const CHAT_COPPER_STEP = COPPER_PER_SILVER;

/** Common chat-round presets (copper). UI may also allow any custom step ≥ 1. */
export const CHAT_ROUND_PRESETS = [
  { copper: 1, labelKey: "1c" as const },
  { copper: 5, labelKey: "5c" as const },
  { copper: 10, labelKey: "10c" as const },
  { copper: 50, labelKey: "50c" as const },
  { copper: COPPER_PER_SILVER, labelKey: "1s" as const },
  { copper: 2 * COPPER_PER_SILVER, labelKey: "2s" as const },
  { copper: 5 * COPPER_PER_SILVER, labelKey: "5s" as const },
  { copper: 10 * COPPER_PER_SILVER, labelKey: "10s" as const },
  { copper: 50 * COPPER_PER_SILVER, labelKey: "50s" as const },
  { copper: COPPER_PER_GOLD, labelKey: "1g" as const },
] as const;

export const CHAT_ROUND_STORAGE_KEY = "mnm-chat-round-copper";

const APP_CHAT_NAME = "MnM Loot Splitter";

export function normalizeChatRoundStep(raw: unknown): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return CHAT_COPPER_STEP;
  const step = Math.trunc(n);
  if (step < 1) return CHAT_COPPER_STEP;
  if (step > COPPER_PER_GOLD * 100) return COPPER_PER_GOLD * 100;
  return step;
}

export function readStoredChatRoundStep(): number {
  if (typeof window === "undefined") return CHAT_COPPER_STEP;
  try {
    return normalizeChatRoundStep(window.localStorage.getItem(CHAT_ROUND_STORAGE_KEY));
  } catch {
    return CHAT_COPPER_STEP;
  }
}

export function writeStoredChatRoundStep(step: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CHAT_ROUND_STORAGE_KEY, String(normalizeChatRoundStep(step)));
  } catch {
    /* ignore quota / private mode */
  }
}

/** Compact label for a copper step: `5c`, `1s`, `5s`, `1g`, `1g 5s`, … */
export function formatChatRoundLabel(step: number): string {
  const unit = normalizeChatRoundStep(step);
  if (unit < COPPER_PER_SILVER) return `${unit}c`;
  const { platinum, gold, silver, copper } = copperToCoins(unit);
  const parts: string[] = [];
  if (platinum) parts.push(`${platinum}p`);
  if (gold) parts.push(`${gold}g`);
  if (silver) parts.push(`${silver}s`);
  if (copper) parts.push(`${copper}c`);
  return parts.length > 0 ? parts.join(" ") : "0c";
}

/**
 * Parse a free-form round step: plain copper (`25`), or shorthand (`5c`, `10c`,
 * `5s`, `1g`, `1g 5s`). Returns null when empty / unparseable.
 */
export function parseChatRoundInput(raw: string): number | null {
  const text = raw.trim().toLowerCase().replace(/,/g, ".");
  if (!text) return null;
  if (/^\d+$/.test(text)) {
    const n = Number(text);
    return n >= 1 ? normalizeChatRoundStep(n) : null;
  }
  const tokenRe = /(\d+)\s*([pgsc])/g;
  let match: RegExpExecArray | null;
  let total = 0;
  let matched = false;
  while ((match = tokenRe.exec(text)) !== null) {
    matched = true;
    const n = Number(match[1]);
    if (!Number.isFinite(n) || n < 0) return null;
    switch (match[2]) {
      case "p":
        total += n * COPPER_PER_PLATINUM;
        break;
      case "g":
        total += n * COPPER_PER_GOLD;
        break;
      case "s":
        total += n * COPPER_PER_SILVER;
        break;
      case "c":
        total += n;
        break;
    }
  }
  if (!matched || total < 1) return null;
  return normalizeChatRoundStep(total);
}

export function roundCopperForChat(copper: number, step: number = CHAT_COPPER_STEP): number {
  if (!Number.isFinite(copper)) return 0;
  const unit = normalizeChatRoundStep(step);
  const sign = copper < 0 ? -1 : 1;
  const abs = Math.abs(Math.trunc(copper));
  return sign * Math.round(abs / unit) * unit;
}

/** Compact coin string for chat after rounding. */
export function formatCoinsChat(copper: number, step: number = CHAT_COPPER_STEP): string {
  const unit = normalizeChatRoundStep(step);
  const amount = roundCopperForChat(copper, unit);
  const abs = Math.abs(amount);
  const { platinum, gold, silver, copper: cp } = copperToCoins(abs);
  const parts: string[] = [];
  if (platinum) parts.push(`${platinum}p`);
  if (gold) parts.push(`${gold}g`);
  if (silver) parts.push(`${silver}s`);
  // Show copper when the step can leave a copper remainder (step < 1s).
  if (unit < COPPER_PER_SILVER && cp) parts.push(`${cp}c`);
  const body =
    parts.length > 0 ? parts.join(" ") : unit < COPPER_PER_SILVER ? "0c" : "0s";
  return amount < 0 ? `-${body}` : body;
}

/** Rounding phrase inside the announce: "exact" at 1c, else "rounded to 10c" (UI makes it clickable). */
export function chatRoundToken(step: number): string {
  const unit = normalizeChatRoundStep(step);
  return unit === 1 ? "exact" : `rounded to ${formatChatRoundLabel(unit)}`;
}

/** When every tip rounds to zero, announce that the split is already fair. */
export const EQUITABLE_CHAT_ANNOUNCE =
  `${APP_CHAT_NAME} — equitable loot split (vendor prices): everyone is even, no tips needed.`;

function chatName(name: string): string {
  return name.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim() || "?";
}

/** One transfer: "Alice>Bob 5g 3s" (ASCII, no newlines). */
export function formatTransferChat(
  transfer: Pick<Transfer, "from" | "to" | "copper">,
  step: number = CHAT_COPPER_STEP,
): string {
  return `${chatName(transfer.from)}>${chatName(transfer.to)} ${formatCoinsChat(transfer.copper, step)}`;
}

export type BuildSettlementChatOptions = {
  maxLen?: number;
  /** Round tips to this many copper (1 = exact copper, 100 = 1s, …). */
  roundCopper?: number;
};

/**
 * Pack fair-share pay-whom lines into one or more single-line English announces
 * that each fit in {@link GAME_CHAT_MAX} characters.
 */
export function buildSettlementChatMessages(
  transfers: Array<Pick<Transfer, "from" | "to" | "copper">>,
  maxLenOrOptions: number | BuildSettlementChatOptions = GAME_CHAT_MAX,
): string[] {
  const options: BuildSettlementChatOptions =
    typeof maxLenOrOptions === "number" ? { maxLen: maxLenOrOptions } : maxLenOrOptions;
  const maxLen = options.maxLen ?? GAME_CHAT_MAX;
  const step = normalizeChatRoundStep(options.roundCopper ?? CHAT_COPPER_STEP);

  const rounded = transfers.filter((transfer) => roundCopperForChat(transfer.copper, step) !== 0);
  if (rounded.length === 0) return [EQUITABLE_CHAT_ANNOUNCE];

  const segments = rounded.map((transfer) => formatTransferChat(transfer, step));
  const sep = " | ";

  // Tell the group how amounts were rounded: "exact" at 1c, else the step ("rounded to 10c").
  // Rounding first, so it reads as the tips being rounded — not the vendor prices.
  const note = `${chatRoundToken(step)}, based on vendor prices`;
  const singleIntro = `${APP_CHAT_NAME} — equitable loot split (${note}), tip whom: `;
  const singleBody = segments.join(sep);
  if (singleIntro.length + singleBody.length <= maxLen) {
    return [singleIntro + singleBody];
  }

  const partIntroLen = `${APP_CHAT_NAME} — equitable split (${note}) (99/99): `.length;
  const budget = Math.max(24, maxLen - partIntroLen);
  const bodies: string[] = [];
  let current = "";

  for (const segment of segments) {
    const piece = segment.length > budget ? segment.slice(0, budget - 1) + "…" : segment;
    if (!current) {
      current = piece;
      continue;
    }
    if (current.length + sep.length + piece.length <= budget) {
      current += sep + piece;
      continue;
    }
    bodies.push(current);
    current = piece;
  }
  if (current) bodies.push(current);

  const total = bodies.length;
  return bodies.map(
    (body, index) =>
      `${APP_CHAT_NAME} — equitable split (${note}) (${index + 1}/${total}): ${body}`,
  );
}
