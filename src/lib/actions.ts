import "server-only";
import "@/lib/zod-fr";
import type { ZodError, ZodType, ZodTypeDef } from "zod";
import { getContext, type AppContext } from "@/lib/auth/context";
import type { Permission } from "@/lib/permissions";

import type { ActionState } from "@/lib/action-state";

export type { ActionState };

/** Codes SQLSTATE dont le message est rédigé en français par nos fonctions SQL. */
const DOMAIN_CODES = new Set(["22023", "23P01", "23514", "P0002", "42501", "23505", "28000"]);
const NATIVE_MESSAGE = /^(new row|permission denied|duplicate key|insert or update|update or delete|null value|value too long|invalid input)/i;

/**
 * Traduit une erreur PostgREST/PostgreSQL en message utilisateur, sans jamais
 * exposer de détail technique (requête, nom de contrainte...).
 */
export function dbErrorMessage(error: { code?: string; message: string } | null | undefined): string {
  if (!error) return "Une erreur est survenue.";
  const { code = "", message } = error;
  if (DOMAIN_CODES.has(code) && !NATIVE_MESSAGE.test(message)) return message;
  if (code === "42501" || /row-level security|permission denied/i.test(message)) return "Action non autorisée.";
  if (code === "23505") return "Cet élément existe déjà.";
  if (code === "23503") return "Élément lié introuvable ou encore utilisé.";
  if (code === "23P01") return "Conflit de dates avec un élément existant.";
  if (code === "23514") return "Valeur refusée par les règles de gestion.";
  console.error("[db]", code, message);
  return "Une erreur est survenue. Réessayez.";
}

export function zodFieldErrors(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/** Valide un FormData avec un schéma Zod. Les champs vides deviennent `undefined`. */
export function parseForm<T>(
  schema: ZodType<T, ZodTypeDef, unknown>,
  formData: FormData,
): { data: T; error?: never } | { data?: never; error: ActionState } {
  const raw: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("$")) continue; // champs internes de Next.js
    const v = typeof value === "string" ? value.trim() : value;
    if (v === "") continue;
    if (key.endsWith("[]")) {
      const k = key.slice(0, -2);
      raw[k] = [...((raw[k] as unknown[]) ?? []), v];
    } else {
      raw[key] = v;
    }
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { error: { error: "Veuillez corriger les champs signalés.", fieldErrors: zodFieldErrors(parsed.error) } };
  }
  return { data: parsed.data };
}

/**
 * Vérification d'autorisation obligatoire en tête de chaque Server Action.
 * Renvoie le contexte, ou un ActionState d'erreur à retourner tel quel.
 */
export async function authorize(
  ...perms: Permission[]
): Promise<{ ctx: AppContext; denied?: never } | { ctx?: never; denied: ActionState }> {
  const ctx = await getContext();
  if (!ctx) return { denied: { error: "Session expirée : reconnectez-vous." } };
  if (perms.length > 0 && !ctx.can(...perms)) return { denied: { error: "Action non autorisée." } };
  return { ctx };
}
