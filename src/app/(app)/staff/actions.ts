"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, dbErrorMessage, parseForm } from "@/lib/actions";
import type { ActionState } from "@/lib/action-state";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";

const roleSchema = z.enum(["owner", "receptionist", "coach"], { errorMap: () => ({ message: "Rôle requis" }) });

const inviteSchema = z.object({
  email: z.string().email("Email invalide").transform((v) => v.toLowerCase()),
  full_name: z.string().min(2, "Nom requis").max(120),
  role: roleSchema,
  job_title: z.string().max(80).optional(),
  create_coach: z.literal("on").optional(),
});

/**
 * Invite un employé. Le client « service role » n'est utilisé qu'APRÈS avoir
 * vérifié que l'appelant possède `staff.manage` dans la salle active, et
 * uniquement pour : créer/inviter le compte Auth et l'insérer dans CETTE salle.
 */
export async function inviteStaff(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize("staff.manage");
  if (auth.denied) return auth.denied;
  const { ctx } = auth;
  const parsed = parseForm(inviteSchema, formData);
  if (parsed.error) return parsed.error;
  const input = parsed.data;

  const admin = createAdminClient();
  const { data: existing } = await admin.from("profiles").select("id").eq("email", input.email).maybeSingle();

  let userId = existing?.id as string | undefined;
  if (userId) {
    const { data: already } = await admin
      .from("staff").select("id").eq("organization_id", ctx.org.id).eq("user_id", userId).maybeSingle();
    if (already) return { fieldErrors: { email: "Cette personne fait déjà partie du personnel." } };
  } else {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(input.email, {
      data: { full_name: input.full_name },
      redirectTo: `${publicEnv.siteUrl}/auth/confirm?next=/update-password`,
    });
    if (error || !data.user) return { error: `Invitation impossible : ${error?.message ?? "erreur inconnue"}` };
    userId = data.user.id;
  }

  const { data: staff, error } = await admin
    .from("staff")
    .insert({ organization_id: ctx.org.id, user_id: userId, role: input.role, job_title: input.job_title ?? null })
    .select("id")
    .single();
  if (error) return { error: dbErrorMessage(error) };

  // Journalisation explicite de l'auteur (le service role n'a pas d'auth.uid()).
  await admin.from("audit_logs").insert({
    organization_id: ctx.org.id, actor_user_id: ctx.user.id, action: "staff.invite", entity_type: "staff",
    entity_id: staff.id, after_data: { email: input.email, role: input.role },
  });

  if (input.role === "coach" && input.create_coach === "on") {
    await admin.from("coaches").insert({
      organization_id: ctx.org.id, staff_id: staff.id, full_name: input.full_name, email: input.email,
    });
  }

  revalidatePath("/staff");
  return { ok: true, message: existing ? "Employé ajouté à la salle." : `Invitation envoyée à ${input.email}.` };
}

const updateSchema = z.object({
  staff_id: z.string().uuid(),
  role: roleSchema,
  job_title: z.string().max(80).optional(),
});

/** Modification du rôle : passe par la session de l'utilisateur => RLS + garde-fous SQL. */
export async function updateStaffRole(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize("staff.manage");
  if (auth.denied) return auth.denied;
  const parsed = parseForm(updateSchema, formData);
  if (parsed.error) return parsed.error;

  const { error, count } = await auth.ctx.supabase
    .from("staff")
    .update({ role: parsed.data.role, job_title: parsed.data.job_title ?? null }, { count: "exact" })
    .eq("organization_id", auth.ctx.org.id)
    .eq("id", parsed.data.staff_id);
  if (error) return { error: dbErrorMessage(error) };
  if (!count) return { error: "Employé introuvable." };
  revalidatePath("/staff");
  return { ok: true, message: "Rôle mis à jour." };
}

export async function setStaffActive(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize("staff.manage");
  if (auth.denied) return auth.denied;
  const parsed = parseForm(z.object({ staff_id: z.string().uuid(), active: z.enum(["true", "false"]) }), formData);
  if (parsed.error) return parsed.error;

  const { error, count } = await auth.ctx.supabase
    .from("staff")
    .update({ is_active: parsed.data.active === "true" }, { count: "exact" })
    .eq("organization_id", auth.ctx.org.id)
    .eq("id", parsed.data.staff_id);
  if (error) return { error: dbErrorMessage(error) };
  if (!count) return { error: "Employé introuvable." };
  revalidatePath("/staff");
  return { ok: true, message: parsed.data.active === "true" ? "Compte réactivé." : "Compte désactivé : l'accès est coupé immédiatement." };
}
