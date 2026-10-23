"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";

import { copy, explain, type Copy } from "@/lib/copy";
import { ErrorCode, type ErrorCode as ErrorCodeName } from "@/lib/codes";
import { formatStamp } from "@/lib/format";
import { isLocale, LOCALES, type Locale } from "@/lib/locale";
import { formatCoins } from "@/lib/money";
import { localizeNote } from "@/lib/notes";

const STORAGE_KEY = "loot-locale";

type LocaleValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  copy: Copy;
  coins: (amount: number) => string;
  stamp: (iso: string) => string;
  explain: (caught: unknown, fallback: ErrorCodeName) => string;
  note: (text: string) => string;
};

const LocaleContext = createContext<LocaleValue | null>(null);

const listeners = new Set<() => void>();

function subscribeLocale(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

function readStoredLocale(): Locale {
  const saved = localStorage.getItem(STORAGE_KEY);
  return isLocale(saved) ? saved : "en";
}

function getServerLocale(): Locale {
  return "en";
}

function writeLocale(next: Locale) {
  localStorage.setItem(STORAGE_KEY, next);
  document.documentElement.lang = next;
  for (const listener of listeners) listener();
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const locale = useSyncExternalStore(subscribeLocale, readStoredLocale, getServerLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    writeLocale(next);
  }, []);

  const coins = useCallback((amount: number) => formatCoins(amount, locale), [locale]);
  const stamp = useCallback((iso: string) => formatStamp(iso, locale), [locale]);
  const explainError = useCallback(
    (caught: unknown, fallback: ErrorCodeName) => explain(locale, caught, fallback),
    [locale],
  );
  const note = useCallback((text: string) => localizeNote(text, locale), [locale]);
  const value = useMemo<LocaleValue>(
    () => ({
      locale,
      setLocale,
      copy: copy[locale],
      coins,
      stamp,
      explain: explainError,
      note,
    }),
    [coins, explainError, locale, note, setLocale, stamp],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useI18n(): LocaleValue {
  const value = useContext(LocaleContext);
  if (!value) {
    return {
      locale: "en",
      setLocale: () => undefined,
      copy: copy.en,
      coins: (amount) => formatCoins(amount, "en"),
      stamp: (iso) => formatStamp(iso, "en"),
      explain: (caught, fallback) => explain("en", caught, fallback),
      note: (text) => localizeNote(text, "en"),
    };
  }
  return value;
}

export { ErrorCode, LOCALES };
