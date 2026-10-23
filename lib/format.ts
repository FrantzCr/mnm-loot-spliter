import { dateTag, type Locale } from "@/lib/locale";

export function itemKey(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr");
}

export function characterKey(server: string | null, name: string): string {
  const serverKey = (server ?? "").normalize("NFKC").trim().toLocaleLowerCase("fr");
  return `${serverKey}::${itemKey(name)}`;
}

export function formatWhen(value: string | null | undefined): string {
  if (!value) return "";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!match) return value;
  return `${match[3]}/${match[2]}/${match[1]} ${match[4]}:${match[5]}`;
}

export function formatStamp(iso: string, locale: Locale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(dateTag(locale), { dateStyle: "short", timeStyle: "short" });
}

export function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!text) return null;
  return text.slice(0, max);
}

/** Title-case each whitespace-separated word (French locale). Keeps spaces as typed. */
export function titleCaseName(value: string, locale = "fr"): string {
  return value.replace(/[^\s]+/g, (word) => {
    const chars = [...word];
    const first = chars[0];
    if (!first) return word;
    return first.toLocaleUpperCase(locale) + chars.slice(1).join("").toLocaleLowerCase(locale);
  });
}
