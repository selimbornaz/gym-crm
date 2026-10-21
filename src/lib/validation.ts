import "@/lib/zod-fr";
import { z } from "zod";
import { normalizeAmount } from "@/lib/format";

/** Champ texte optionnel (vide => undefined), longueur bornée. */
export const optionalText = (max = 500) => z.string().trim().max(max, `${max} caractères maximum`).optional();

export const phone = z
  .string()
  .trim()
  .regex(/^\+?[\d\s.-]{8,20}$/, "Numéro de téléphone invalide");

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide");

/** Montant en dinars saisi par l'utilisateur -> chaîne décimale à 3 chiffres. */
export const amount = z
  .string()
  .transform((v, ctx) => {
    const n = normalizeAmount(v);
    if (n === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Montant invalide (ex. 80 ou 80,500)" });
      return z.NEVER;
    }
    return n;
  });

export const positiveAmount = amount.refine((v) => Number(v) > 0, "Le montant doit être supérieur à 0");

export const uuid = z.string().uuid("Identifiant invalide");

/**
 * Nettoie une recherche libre avant de l'insérer dans un filtre PostgREST
 * `.or(...)` : supprime les caractères de syntaxe (virgules, parenthèses,
 * jokers) pour empêcher toute injection de filtre.
 */
export function sanitizeSearch(q: string | undefined): string {
  return (q ?? "").replace(/[,()*%\\:"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}
