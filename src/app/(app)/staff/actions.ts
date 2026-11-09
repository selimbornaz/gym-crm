"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, dbErrorMessage, parseForm } from "@/lib/actions";
import type { ActionState } from "@/lib/action-state";
import { runChatOp } from "@/lib/chatbot/remote";
import { staffEmail, staffPassword, staffRole as roleSchema } from "@/lib/staff/schema";

const createSchema = z
  .object({
    full_name: z.string().trim().min(2, "Nom requis").max(120),
    email: staffEmail,
    password: staffPassword,
    password_confirm: z.string(),
    role: roleSchema,
    job_title: z.string().trim().max(80).optional(),
    create_coach: z.literal("on").optional(),
  })
  .refine((v) => v.password === v.password_confirm, { path: ["password_confirm"], message: "Les deux mots de passe sont différents" });

/**
 * Crée directement le compte d'un employé (email + mot de passe choisis par le
 * propriétaire, sans email d'invitation) et l'ajoute à la salle active.
 */
export async function createStaff(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize("staff.manage");
  if (auth.denied) return auth.denied;
  const parsed = parseForm(createSchema, formData);
  if (parsed.error) return parsed.error;
<<<<<<< HEAD
  const input = parsed.data;

  // Le logiciel de bureau n'embarque aucune clé d'administration.
  if (process.env.NEXT_PUBLIC_CASTLE_DESKTOP === "1") {
    return { error: "Les invitations se font depuis le site web de Dopamine Fitness." };
  }
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
=======
  const d = parsed.data;
  const result = await runChatOp(auth.ctx, {
    op: "staff_create",
    fullName: d.full_name,
    email: d.email,
    password: d.password,
    role: d.role,
    jobTitle: d.job_title || null,
    createCoach: d.create_coach === "on",
>>>>>>> local-main/main
  });
  revalidatePath("/staff");
  return result;
}

const passwordSchema = z
  .object({ staff_id: z.string().uuid(), password: staffPassword, password_confirm: z.string() })
  .refine((v) => v.password === v.password_confirm, { path: ["password_confirm"], message: "Les deux mots de passe sont différents" });

/** Nouveau mot de passe choisi par le propriétaire (employé qui l'a oublié). */
export async function resetStaffPassword(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize("staff.manage");
  if (auth.denied) return auth.denied;
  const parsed = parseForm(passwordSchema, formData);
  if (parsed.error) return parsed.error;
  return runChatOp(auth.ctx, { op: "staff_password", staffId: parsed.data.staff_id, password: parsed.data.password });
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
