import type { Locale } from "@/lib/locale";

type Phrase = Record<Locale, string>;

const EXACT: Array<{ match: string[]; phrase: Phrase }> = [
  {
    match: ["unreadable file.", "fichier illisible."],
    phrase: { en: "unreadable file.", fr: "fichier illisible.", es: "archivo ilegible." },
  },
  {
    match: ["file too large, skipped.", "fichier trop volumineux, ignoré."],
    phrase: {
      en: "file too large, skipped.",
      fr: "fichier trop volumineux, ignoré.",
      es: "archivo demasiado grande, ignorado.",
    },
  },
  {
    match: ["unreadable JSON.", "JSON illisible."],
    phrase: { en: "unreadable JSON.", fr: "JSON illisible.", es: "JSON ilegible." },
  },
  {
    match: ["could not save.", "enregistrement impossible."],
    phrase: { en: "could not save.", fr: "enregistrement impossible.", es: "no se pudo guardar." },
  },
  {
    match: ["Not a JSON object.", "Le fichier n'est pas un objet JSON."],
    phrase: {
      en: "Not a JSON object.",
      fr: "Le fichier n'est pas un objet JSON.",
      es: "El archivo no es un objeto JSON.",
    },
  },
  {
    match: ["No c01 list (event log).", "Pas de liste c01 (journal d'événements)."],
    phrase: {
      en: "No c01 list (event log).",
      fr: "Pas de liste c01 (journal d'événements).",
      es: "No hay lista c01 (registro de eventos).",
    },
  },
  {
    match: ["c01 is not a list.", "c01 n'est pas une liste."],
    phrase: { en: "c01 is not a list.", fr: "c01 n'est pas une liste.", es: "c01 no es una lista." },
  },
];

export function localizeNote(note: string, locale: Locale): string {
  const split = note.match(/^(.*?) : (.+)$/);
  const head = split?.[1] ?? "";
  const tail = split?.[2] ?? note;
  const translated = translateTail(tail, locale);
  return head ? `${head} : ${translated}` : translated;
}

function translateTail(tail: string, locale: Locale): string {
  const exact = EXACT.find((row) => row.match.includes(tail));
  if (exact) return exact.phrase[locale];

  const events =
    tail.match(/^(\d+) events?, no act_13 loot(.*)\.$/) ??
    tail.match(/^(\d+) événements?, aucun butin act_13(.*)\.$/);
  if (events) return eventLine(Number(events[1]), events[2] ?? "", locale);

  const unnamed =
    tail.match(/^(\d+) loot lines? without an item name \(d04\), skipped\.$/) ??
    tail.match(/^(\d+) butin sans nom d'objet \(d04\), ignoré\.$/);
  if (unnamed) return unnamedItem(Number(unnamed[1]), locale);

  const unowned =
    tail.match(/^(\d+) loot lines? without a character name, skipped\.$/) ??
    tail.match(/^(\d+) butin sans nom de personnage, ignoré\.$/);
  if (unowned) return unnamedCharacter(Number(unowned[1]), locale);

  return tail;
}

function eventLine(count: number, codes: string, locale: Locale): string {
  if (locale === "fr") {
    return `${count} événement${count > 1 ? "s" : ""}, aucun butin act_13${codes}.`;
  }
  if (locale === "es") {
    return `${count} evento${count > 1 ? "s" : ""}, ningún botín act_13${codes}.`;
  }
  return `${count} ${count === 1 ? "event" : "events"}, no act_13 loot${codes}.`;
}

function unnamedItem(count: number, locale: Locale): string {
  if (locale === "fr") return `${count} butin sans nom d'objet (d04), ignoré.`;
  if (locale === "es") {
    const noun = count === 1 ? "botín" : "botines";
    const skipped = count === 1 ? "ignorado" : "ignorados";
    return `${count} ${noun} sin nombre de objeto (d04), ${skipped}.`;
  }
  return `${count} loot ${count === 1 ? "line" : "lines"} without an item name (d04), skipped.`;
}

function unnamedCharacter(count: number, locale: Locale): string {
  if (locale === "fr") return `${count} butin sans nom de personnage, ignoré.`;
  if (locale === "es") {
    const noun = count === 1 ? "botín" : "botines";
    const skipped = count === 1 ? "ignorado" : "ignorados";
    return `${count} ${noun} sin nombre de personaje, ${skipped}.`;
  }
  return `${count} loot ${count === 1 ? "line" : "lines"} without a character name, skipped.`;
}
