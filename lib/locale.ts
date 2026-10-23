export type Locale = "en" | "fr" | "es";

export const LOCALES: readonly Locale[] = ["en", "fr", "es"];

export function isLocale(value: string | null): value is Locale {
  return value === "en" || value === "fr" || value === "es";
}

export function dateTag(locale: Locale): string {
  if (locale === "fr") return "fr-FR";
  if (locale === "es") return "es-ES";
  return "en-GB";
}
