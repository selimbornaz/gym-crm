import { fr, type Dictionary } from "./fr";

export type Locale = "fr" | "ar";

const dictionaries: Partial<Record<Locale, Dictionary>> = { fr };

/** Dictionnaire de la langue demandée (repli sur le français). */
export function getDictionary(locale: Locale = "fr"): Dictionary {
  return dictionaries[locale] ?? fr;
}

export const dirOf = (locale: Locale): "ltr" | "rtl" => (locale === "ar" ? "rtl" : "ltr");

/** Raccourci : dictionnaire par défaut (l'application est en français). */
export const t = fr;
