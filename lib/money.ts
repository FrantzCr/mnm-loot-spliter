/**
 * Coin ladder used by the client.
 * 100 copper = 1 silver is how players describe an even split on the
 * official forum. The same 100:1 step continues through gold and platinum
 * (100 silver = 1 gold, 100 gold = 1 platinum), as published by the
 * community price checker The Tunnel. Values are stored as copper so a
 * line total cannot drift when the price book changes.
 */
export const COPPER_PER_SILVER = 100;
export const SILVER_PER_GOLD = 100;
export const GOLD_PER_PLATINUM = 100;

export const COPPER_PER_GOLD = COPPER_PER_SILVER * SILVER_PER_GOLD;
export const COPPER_PER_PLATINUM = COPPER_PER_GOLD * GOLD_PER_PLATINUM;

export type CoinParts = {
  platinum: number;
  gold: number;
  silver: number;
  copper: number;
};

export const EMPTY_COINS: CoinParts = {
  platinum: 0,
  gold: 0,
  silver: 0,
  copper: 0,
};

const MAX_COPPER = 999_999 * COPPER_PER_PLATINUM;

export function coinsToCopper(parts: CoinParts): number {
  const platinum = clampInt(parts.platinum);
  const gold = clampInt(parts.gold);
  const silver = clampInt(parts.silver);
  const copper = clampInt(parts.copper);
  return (
    platinum * COPPER_PER_PLATINUM +
    gold * COPPER_PER_GOLD +
    silver * COPPER_PER_SILVER +
    copper
  );
}

export function copperToCoins(total: number): CoinParts {
  let rest = Math.abs(Math.trunc(total));
  const copper = rest % COPPER_PER_SILVER;
  rest = Math.floor(rest / COPPER_PER_SILVER);
  const silver = rest % SILVER_PER_GOLD;
  rest = Math.floor(rest / SILVER_PER_GOLD);
  const gold = rest % GOLD_PER_PLATINUM;
  const platinum = Math.floor(rest / GOLD_PER_PLATINUM);
  return { platinum, gold, silver, copper };
}

const COIN_NAMES = {
  en: { platinum: "platinum", gold: "gold", silver: "silver", copper: "copper" },
  fr: { platinum: "platine", gold: "or", silver: "argent", copper: "cuivre" },
  es: { platinum: "platino", gold: "oro", silver: "plata", copper: "cobre" },
} as const;

export function formatCoins(total: number, locale: keyof typeof COIN_NAMES = "en"): string {
  if (!Number.isFinite(total)) return "—";
  const sign = total < 0 ? "−" : "";
  const names = COIN_NAMES[locale];
  const { platinum, gold, silver, copper } = copperToCoins(total);
  if (platinum + gold + silver + copper === 0) return `0 ${names.copper}`;
  const parts: string[] = [];
  if (platinum) parts.push(`${platinum} ${names.platinum}`);
  if (gold) parts.push(`${gold} ${names.gold}`);
  if (silver) parts.push(`${silver} ${names.silver}`);
  if (copper) parts.push(`${copper} ${names.copper}`);
  return sign + parts.join(" ");
}

export function isValidCopper(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_COPPER;
}

function clampInt(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.trunc(value), 999_999);
}
