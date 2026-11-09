import "server-only";
import type { ActionState } from "@/lib/action-state";
import { createAdminClient } from "@/lib/supabase/admin";
import type { StaffRole } from "@/lib/permissions";

/**
 * Comptes du personnel créés directement par le propriétaire (sans email
 * d'invitation). Utilise la clé « service role » : à n'appeler qu'APRÈS avoir
 * vérifié que l'appelant possède `staff.manage` dans la salle `orgId`.
 */
export interface StaffActor {
  userId: string;
  orgId: string;
}

export interface NewStaff {
  fullName: string;
  email: string;
  password: string;
  role: StaffRole;
  jobTitle: string | null;
  createCoach: boolean;
}

export async function createStaffCore(actor: StaffActor, input: NewStaff): Promise<ActionState> {
  const admin = createAdminClient();
  const { data: existing } = await admin.from("profiles").select("id").eq("email", input.email).maybeSingle();

  let userId = existing?.id as string | undefined;
  let created = false;
  if (userId) {
    const { data: already } = await admin
      .from("staff").select("id").eq("organization_id", actor.orgId).eq("user_id", userId).maybeSingle();
    if (already) return { fieldErrors: { email: "Cette personne fait déjà partie du personnel." } };
    // Compte existant (peut-être lié à une autre salle) : on ne touche JAMAIS à son mot de passe.
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { full_name: input.fullName },
    });
    if (error || !data.user) {
      if (/password/i.test(error?.message ?? "")) return { fieldErrors: { password: "Mot de passe refusé : choisissez-en un plus long et moins courant." } };
      return { error: `Création du compte impossible : ${error?.message ?? "erreur inconnue"}` };
    }
    userId = data.user.id;
    created = true;
  }

  const { data: staff, error } = await admin
    .from("staff")
    .insert({ organization_id: actor.orgId, user_id: userId, role: input.role, job_title: input.jobTitle })
    .select("id")
    .single();
  if (error || !staff) {
    // Pas de compte orphelin si l'ajout à la salle échoue.
    if (created) await admin.auth.admin.deleteUser(userId);
    return { error: "Ajout à la salle impossible : réessayez." };
  }

  // Journalisation explicite de l'auteur (le service role n'a pas d'auth.uid()). Jamais le mot de passe.
  await admin.from("audit_logs").insert({
    organization_id: actor.orgId,
    actor_user_id: actor.userId,
    action: "staff.create",
    entity_type: "staff",
    entity_id: staff.id,
    after_data: { email: input.email, role: input.role, new_account: created },
  });

  if (input.role === "coach" && input.createCoach) {
    await admin.from("coaches").insert({ organization_id: actor.orgId, staff_id: staff.id, full_name: input.fullName, email: input.email });
  }

  return {
    ok: true,
    message: created
      ? `Compte créé : ${input.email} peut se connecter avec le mot de passe choisi.`
      : `${input.email} avait déjà un compte : il est ajouté à la salle et garde son mot de passe actuel.`,
  };
}

/**
 * Nouveau mot de passe pour un employé. Garde-fous : pas soi-même, pas un autre
 * propriétaire, et seulement si TOUTES les salles de l'employé sont des salles
 * dont l'appelant est propriétaire (un compte partagé avec une autre salle reste intouchable).
 */
export async function resetStaffPasswordCore(actor: StaffActor, staffId: string, password: string): Promise<ActionState> {
  const admin = createAdminClient();
  const { data: target } = await admin
    .from("staff").select("id, user_id, role").eq("organization_id", actor.orgId).eq("id", staffId).maybeSingle();
  if (!target) return { error: "Employé introuvable." };
  if (target.user_id === actor.userId) return { error: "Pour votre propre compte, utilisez « Mot de passe oublié » sur la page de connexion." };
  if (target.role === "owner") return { error: "Le mot de passe d'un autre propriétaire ne peut pas être changé ici." };

  const [{ data: targetOrgs }, { data: myOwnerOrgs }] = await Promise.all([
    admin.from("staff").select("organization_id").eq("user_id", target.user_id),
    admin.from("staff").select("organization_id").eq("user_id", actor.userId).eq("role", "owner").eq("is_active", true),
  ]);
  const mine = new Set((myOwnerOrgs ?? []).map((r) => r.organization_id as string));
  if ((targetOrgs ?? []).some((r) => !mine.has(r.organization_id as string))) {
    return { error: "Ce compte est aussi utilisé dans une autre salle : son mot de passe ne peut pas être changé ici." };
  }

  const { error } = await admin.auth.admin.updateUserById(target.user_id as string, { password });
  if (error) {
    if (/password/i.test(error.message)) return { fieldErrors: { password: "Mot de passe refusé : choisissez-en un plus long et moins courant." } };
    return { error: "Changement impossible : réessayez." };
  }
  await admin.from("audit_logs").insert({
    organization_id: actor.orgId,
    actor_user_id: actor.userId,
    action: "staff.password_reset",
    entity_type: "staff",
    entity_id: target.id,
  });
  return { ok: true, message: "Mot de passe changé : communiquez-le à l'employé." };
}
