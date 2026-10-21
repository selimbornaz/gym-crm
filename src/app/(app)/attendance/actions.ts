"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, dbErrorMessage, parseForm } from "@/lib/actions";
import type { ActionState } from "@/lib/action-state";
import { tunisLocalToIso } from "@/lib/format";
import { sanitizeSearch, uuid } from "@/lib/validation";

export interface CheckInCandidate {
  id: string;
  member_code: string;
  full_name: string;
  phone: string | null;
  membership_status: string;
  membership_end_date: string | null;
}

export interface CheckInOutcome {
  result: "granted" | "denied" | "duplicate";
  message: string;
  can_override?: boolean;
  overridden?: boolean;
  attendance_id?: string;
  member: { id: string; code: string; name: string; photo_path: string | null };
  membership: { plan: string | null; end_date: string | null; access_restrictions: string | null };
}

/** Recherche rapide à l'accueil (nom, téléphone, n° membre). */
export async function searchForCheckIn(query: string): Promise<CheckInCandidate[]> {
  const auth = await authorize("attendance.write");
  if (auth.denied) return [];
  const q = sanitizeSearch(query);
  if (q.length < 2) return [];
  const { data } = await auth.ctx.supabase
    .from("member_directory")
    .select("id, member_code, full_name, phone, membership_status, membership_end_date")
    .eq("organization_id", auth.ctx.org.id)
    .is("archived_at", null)
    .or(`first_name.ilike.*${q}*,last_name.ilike.*${q}*,member_code.ilike.*${q}*,phone_digits.ilike.*${q.replace(/\D/g, "") || q}*`)
    .order("last_name")
    .limit(8);
  return (data ?? []) as CheckInCandidate[];
}

const checkInSchema = z.object({
  member_id: uuid.optional(),
  member_code: z.string().trim().max(40).optional(),
  method: z.enum(["search", "member_code", "qr", "manual"]),
  override_reason: z.string().trim().max(300).optional(),
});

/**
 * Enregistre une entrée. Toutes les règles d'accès sont appliquées par la
 * fonction SQL `check_in` (abonnement valide, suspension, doublon, dérogation).
 */
export async function checkInMember(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize("attendance.write");
  if (auth.denied) return auth.denied;
  const { ctx } = auth;
  const parsed = parseForm(checkInSchema, formData);
  if (parsed.error) return parsed.error;
  let memberId = parsed.data.member_id;

  if (!memberId && parsed.data.member_code) {
    const { data } = await ctx.supabase
      .from("members")
      .select("id")
      .eq("organization_id", ctx.org.id)
      .ilike("member_code", parsed.data.member_code)
      .maybeSingle();
    if (!data) return { error: `Aucun membre avec le n° « ${parsed.data.member_code} ».` };
    memberId = data.id as string;
  }
  if (!memberId) return { error: "Sélectionnez un membre." };

  const { data, error } = await ctx.supabase.rpc("check_in", {
    p_org: ctx.org.id,
    p_member: memberId,
    p_method: parsed.data.method,
    p_override_reason: parsed.data.override_reason ?? null,
  });
  if (error) return { error: dbErrorMessage(error) };

  const outcome = data as CheckInOutcome;
  if (outcome.result === "granted") revalidatePath("/attendance");
  return { ok: outcome.result === "granted", data: outcome };
}

export async function checkOut(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize("attendance.write");
  if (auth.denied) return auth.denied;
  const id = uuid.safeParse(formData.get("attendance_id"));
  if (!id.success) return { error: "Passage invalide." };
  const { error } = await auth.ctx.supabase.rpc("check_out", { p_org: auth.ctx.org.id, p_attendance: id.data });
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/attendance");
  return { ok: true, message: "Sortie enregistrée." };
}

const correctionSchema = z.object({
  attendance_id: uuid,
  reason: z.string().trim().min(3, "Motif obligatoire").max(300),
  void: z.literal("on").optional(),
  checked_in_at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional(),
  checked_out_at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional(),
});

/** Correction manuelle (heure erronée, passage à annuler) : tracée dans l'audit. */
export async function correctAttendance(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize("attendance.correct");
  if (auth.denied) return auth.denied;
  const parsed = parseForm(correctionSchema, formData);
  if (parsed.error) return parsed.error;
  const d = parsed.data;
  const { error } = await auth.ctx.supabase.rpc("correct_attendance", {
    p_org: auth.ctx.org.id,
    p_attendance: d.attendance_id,
    p_reason: d.reason,
    p_void: d.void === "on",
    p_checked_in_at: d.checked_in_at ? tunisLocalToIso(d.checked_in_at) : null,
    p_checked_out_at: d.checked_out_at ? tunisLocalToIso(d.checked_out_at) : null,
  });
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/attendance");
  return { ok: true, message: d.void === "on" ? "Passage annulé." : "Passage corrigé." };
}
