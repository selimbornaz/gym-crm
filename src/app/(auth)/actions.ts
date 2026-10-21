"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";
import { parseForm } from "@/lib/actions";
import type { ActionState } from "@/lib/action-state";

const loginSchema = z.object({
  email: z.string().email("Adresse email invalide"),
  password: z.string().min(1, "Mot de passe requis"),
  next: z.string().optional(),
});

/** Ne redirige que vers un chemin interne (protection « open redirect »). */
function safeNext(next: string | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

export async function signIn(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(loginSchema, formData);
  if (parsed.error) return parsed.error;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password });
  if (error) {
    // Message volontairement générique : ne révèle pas si le compte existe.
    return { error: "Email ou mot de passe incorrect." };
  }
  redirect(safeNext(parsed.data.next));
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

const emailSchema = z.object({ email: z.string().email("Adresse email invalide") });

export async function requestPasswordReset(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(emailSchema, formData);
  if (parsed.error) return parsed.error;
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${publicEnv.siteUrl}/auth/confirm?next=/update-password`,
  });
  // Même réponse que le compte existe ou non.
  return { ok: true, message: "Si un compte existe pour cette adresse, un email de réinitialisation a été envoyé." };
}

const passwordSchema = z
  .object({
    password: z
      .string()
      .min(10, "10 caractères minimum")
      .regex(/[A-Za-z]/, "Au moins une lettre")
      .regex(/\d/, "Au moins un chiffre"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "Les mots de passe ne correspondent pas", path: ["confirm"] });

/** Définition du mot de passe (après invitation ou lien de réinitialisation). */
export async function updatePassword(_: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseForm(passwordSchema, formData);
  if (parsed.error) return parsed.error;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Lien expiré : demandez un nouveau lien de réinitialisation." };
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: "Impossible de mettre à jour le mot de passe. Réessayez." };
  redirect("/dashboard");
}
