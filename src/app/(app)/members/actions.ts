"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authorize, dbErrorMessage, parseForm } from "@/lib/actions";
import type { ActionState } from "@/lib/action-state";
import { isoDate, optionalText, phone, uuid } from "@/lib/validation";

const memberSchema = z.object({
  first_name: z.string().trim().min(1, "Prénom requis").max(80),
  last_name: z.string().trim().min(1, "Nom requis").max(80),
  phone: phone.optional(),
  email: z.string().trim().toLowerCase().email("Email invalide").optional(),
  birth_date: isoDate.optional(),
  gender: z.enum(["female", "male", "unspecified"]).optional(),
  address: optionalText(300),
  emergency_contact_name: optionalText(120),
  emergency_contact_phone: phone.optional(),
  coach_id: uuid.optional(),
  confirm_duplicate: z.literal("on").optional(),
});

export interface DuplicateCandidate {
  id: string;
  member_code: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  match_reason: string;
}

function toRow(data: z.infer<typeof memberSchema>) {
  const { confirm_duplicate: _confirm, ...row } = data;
  return {
    ...row,
    phone: row.phone ?? null,
    email: row.email ?? null,
    birth_date: row.birth_date ?? null,
    gender: row.gender ?? null,
    address: row.address ?? null,
    emergency_contact_name: row.emergency_contact_name ?? null,
    emergency_contact_phone: row.emergency_contact_phone ?? null,
    coach_id: row.coach_id ?? null,
  };
}

/** Création d'un membre, avec détection de doublons (confirmation explicite requise). */
export async function createMember(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize("members.write");
  if (auth.denied) return auth.denied;
  const { ctx } = auth;
  const parsed = parseForm(memberSchema, formData);
  if (parsed.error) return parsed.error;

  if (!parsed.data.confirm_duplicate) {
    const { data: dups } = await ctx.supabase.rpc("find_member_duplicates", {
      p_org: ctx.org.id,
      p_first_name: parsed.data.first_name,
      p_last_name: parsed.data.last_name,
      p_phone: parsed.data.phone ?? null,
      p_email: parsed.data.email ?? null,
    });
    if (dups && dups.length > 0) {
      return {
        error: "Un membre similaire existe déjà. Vérifiez avant de créer un doublon.",
        data: { duplicates: dups as DuplicateCandidate[] },
      };
    }
  }

  const { data, error } = await ctx.supabase
    .from("members")
    .insert({ ...toRow(parsed.data), organization_id: ctx.org.id })
    .select("id")
    .single();
  if (error) return { error: dbErrorMessage(error) };

  revalidatePath("/members");
  redirect(`/members/${data.id}?created=1`);
}

export async function updateMember(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize("members.write");
  if (auth.denied) return auth.denied;
  const memberId = uuid.safeParse(formData.get("member_id"));
  if (!memberId.success) return { error: "Membre invalide." };
  const parsed = parseForm(memberSchema, formData);
  if (parsed.error) return parsed.error;

  const { error, count } = await auth.ctx.supabase
    .from("members")
    .update(toRow(parsed.data), { count: "exact" })
    .eq("organization_id", auth.ctx.org.id)
    .eq("id", memberId.data);
  if (error) return { error: dbErrorMessage(error) };
  if (!count) return { error: "Membre introuvable." };

  revalidatePath(`/members/${memberId.data}`);
  redirect(`/members/${memberId.data}`);
}

export async function archiveMember(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize("members.archive");
  if (auth.denied) return auth.denied;
  const parsed = parseForm(
    z.object({ member_id: uuid, archive: z.enum(["true", "false"]), reason: optionalText(300) }),
    formData,
  );
  if (parsed.error) return parsed.error;
  const archive = parsed.data.archive === "true";
  if (archive && !parsed.data.reason) return { fieldErrors: { reason: "Motif requis" } };

  const { error, count } = await auth.ctx.supabase
    .from("members")
    .update(
      archive ? { archived_at: new Date().toISOString(), archive_reason: parsed.data.reason } : { archived_at: null, archive_reason: null },
      { count: "exact" },
    )
    .eq("organization_id", auth.ctx.org.id)
    .eq("id", parsed.data.member_id);
  if (error) return { error: dbErrorMessage(error) };
  if (!count) return { error: "Membre introuvable." };
  revalidatePath(`/members/${parsed.data.member_id}`);
  revalidatePath("/members");
  return { ok: true, message: archive ? "Membre archivé (historique conservé)." : "Membre restauré." };
}

/** Enregistre le chemin de la photo déjà téléversée (le stockage vérifie la salle). */
export async function setMemberPhoto(memberId: string, path: string | null): Promise<ActionState> {
  const auth = await authorize("members.write");
  if (auth.denied) return auth.denied;
  if (!uuid.safeParse(memberId).success) return { error: "Membre invalide." };
  if (path !== null && !path.startsWith(`${auth.ctx.org.id}/${memberId}/`)) return { error: "Chemin de fichier invalide." };

  const { error } = await auth.ctx.supabase
    .from("members")
    .update({ photo_path: path })
    .eq("organization_id", auth.ctx.org.id)
    .eq("id", memberId);
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath(`/members/${memberId}`);
  return { ok: true, message: path ? "Photo mise à jour." : "Photo retirée." };
}

export async function addMemberNote(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize("member_notes.manage");
  if (auth.denied) return auth.denied;
  const parsed = parseForm(z.object({ member_id: uuid, body: z.string().trim().min(1, "Note vide").max(4000) }), formData);
  if (parsed.error) return parsed.error;
  const { error } = await auth.ctx.supabase.from("member_notes").insert({
    organization_id: auth.ctx.org.id, member_id: parsed.data.member_id, body: parsed.data.body, created_by: auth.ctx.user.id,
  });
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath(`/members/${parsed.data.member_id}`);
  return { ok: true, message: "Note ajoutée." };
}

export async function deleteMemberNote(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize("member_notes.manage");
  if (auth.denied) return auth.denied;
  const parsed = parseForm(z.object({ note_id: uuid, member_id: uuid }), formData);
  if (parsed.error) return parsed.error;
  const { error, count } = await auth.ctx.supabase
    .from("member_notes")
    .delete({ count: "exact" })
    .eq("organization_id", auth.ctx.org.id)
    .eq("id", parsed.data.note_id);
  if (error) return { error: dbErrorMessage(error) };
  if (!count) return { error: "Seul l'auteur peut supprimer sa note." };
  revalidatePath(`/members/${parsed.data.member_id}`);
  return { ok: true, message: "Note supprimée." };
}
