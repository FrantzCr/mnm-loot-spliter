import { COPPER_PER_SILVER, copperToCoins } from "@/lib/money";
import type { Transfer } from "@/lib/split";

/**
 * Conservative single-line limit for MnM group/say chat (no newlines).
 * Official docs do not publish a hard cap; stay under common classic-MMO limits.
 */
export const GAME_CHAT_MAX = 240;

/** Chat tips round to the nearest silver (100 copper). */
export const CHAT_COPPER_STEP = COPPER_PER_SILVER;

export function roundCopperForChat(copper: number): number {
  if (!Number.isFinite(copper)) return 0;
  const sign = copper < 0 ? -1 : 1;
  const abs = Math.abs(Math.trunc(copper));
  return sign * Math.round(abs / CHAT_COPPER_STEP) * CHAT_COPPER_STEP;
}

/** Compact coin string for chat: "2p 5g 12s" (rounded to silver; copper omitted). */
export function formatCoinsChat(copper: number): string {
  const amount = roundCopperForChat(copper);
  const abs = Math.abs(amount);
  const { platinum, gold, silver } = copperToCoins(abs);
  const parts: string[] = [];
  if (platinum) parts.push(`${platinum}p`);
  if (gold) parts.push(`${gold}g`);
  if (silver) parts.push(`${silver}s`);
  const body = parts.length > 0 ? parts.join(" ") : "0s";
  return amount < 0 ? `-${body}` : body;
}

/** When every tip rounds under a silver, announce that the split is already fair. */
export const EQUITABLE_CHAT_ANNOUNCE =
  "FYI — Currently for an equitable loot split based on vendor loot prices, everyone is even, no tips needed.";

function chatName(name: string): string {
  return name.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim() || "?";
}

/** One transfer: "Alice>Bob 5g 3s" (ASCII, no newlines, rounded to silver). */
export function formatTransferChat(transfer: Pick<Transfer, "from" | "to" | "copper">): string {
  return `${chatName(transfer.from)}>${chatName(transfer.to)} ${formatCoinsChat(transfer.copper)}`;
}

/**
 * Pack fair-share pay-whom lines into one or more single-line English announces
 * that each fit in {@link GAME_CHAT_MAX} characters.
 */
export function buildSettlementChatMessages(
  transfers: Array<Pick<Transfer, "from" | "to" | "copper">>,
  maxLen: number = GAME_CHAT_MAX,
): string[] {
  const rounded = transfers.filter((transfer) => roundCopperForChat(transfer.copper) !== 0);
  if (rounded.length === 0) return [EQUITABLE_CHAT_ANNOUNCE];

  const segments = rounded.map(formatTransferChat);
  const sep = " | ";

  // Friendly FYI one-liner for group chat — no newlines, not a demand.
  const singleIntro =
    "FYI — Currently for an equitable loot split based on vendor loot prices, here's who can tip whom: ";
  const singleBody = segments.join(sep);
  if (singleIntro.length + singleBody.length <= maxLen) {
    return [singleIntro + singleBody];
  }

  // Multi-part: reserve room for "FYI — equitable split (vendor prices) (99/99): "
  const partIntroLen = "FYI — equitable split (vendor prices) (99/99): ".length;
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
    (body, index) => `FYI — equitable split (vendor prices) (${index + 1}/${total}): ${body}`,
  );
}
