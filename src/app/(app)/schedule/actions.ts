"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, dbErrorMessage, parseForm } from "@/lib/actions";
import type { ActionState } from "@/lib/action-state";
import { getMyCoachId } from "@/lib/coach";
import { addDaysIso, tunisLocalToIso } from "@/lib/format";
import { isoDate, optionalText, uuid } from "@/lib/validation";

const sessionSchema = z
  .object({
    kind: z.enum(["group_class", "personal_training"]),
    title: z.string().trim().min(2, "Titre requis").max(120),
    coach_id: uuid.optional(),
    date: isoDate,
    start_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Heure invalide"),
    duration: z.coerce.number().int().min(15, "15 min minimum").max(480, "8 h maximum"),
    capacity: z.coerce.number().int().min(1, "1 minimum").max(500).optional(),
    room: optionalText(60),
    notes: optionalText(500),
    repeat_weeks: z.coerce.number().int().min(0).max(12, "12 semaines maximum").default(0),
  })
  .refine((s) => s.kind === "personal_training" || s.capacity, { message: "Capacité requise", path: ["capacity"] });

/**
 * Crée une séance (et ses répétitions hebdomadaires). Le chevauchement d'un
 * coach est refusé par une contrainte d'exclusion en base, même en cas de
 * requêtes simultanées.
 */
export async function createSession(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize("schedule.manage", "schedule.manage_own");
  if (auth.denied) return auth.denied;
  const { ctx } = auth;
  const parsed = parseForm(sessionSchema, formData);
  if (parsed.error) return parsed.error;
  const s = parsed.data;

  const coachId = ctx.can("schedule.manage") ? (s.coach_id ?? null) : await getMyCoachId(ctx);
  if (!ctx.can("schedule.manage") && !coachId) return { error: "Aucune fiche coach n'est liée à votre compte." };
  if (s.kind === "personal_training" && !coachId) return { fieldErrors: { coach_id: "Un coaching individuel nécessite un coach" } };

  const rows = Array.from({ length: s.repeat_weeks + 1 }, (_, week) => {
    const day = addDaysIso(s.date, week * 7);
    const startsAt = tunisLocalToIso(`${day}T${s.start_time}`);
    return {
      organization_id: ctx.org.id,
      kind: s.kind,
      title: s.title,
      coach_id: coachId,
      room: s.room ?? null,
      notes: s.notes ?? null,
      starts_at: startsAt,
      ends_at: new Date(new Date(startsAt).getTime() + s.duration * 60_000).toISOString(),
      capacity: s.kind === "personal_training" ? 1 : s.capacity!,
    };
  });
  if (new Date(rows[0]!.starts_at) < new Date()) return { fieldErrors: { date: "La séance doit être dans le futur" } };

  const { error } = await ctx.supabase.from("sessions").insert(rows);
  if (error) {
    if (error.code === "23P01") return { error: "Ce coach a déjà une séance sur ce créneau (ou sur l'une des répétitions)." };
    return { error: dbErrorMessage(error) };
  }
  revalidatePath("/schedule");
  return { ok: true, message: rows.length > 1 ? `${rows.length} séances créées.` : "Séance créée." };
}

export async function cancelSession(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize("schedule.manage", "schedule.manage_own");
  if (auth.denied) return auth.denied;
  const id = uuid.safeParse(formData.get("session_id"));
  if (!id.success) return { error: "Séance invalide." };
  const { error, count } = await auth.ctx.supabase
    .from("sessions")
    .update({ status: "cancelled" }, { count: "exact" })
    .eq("organization_id", auth.ctx.org.id)
    .eq("id", id.data)
    .eq("status", "scheduled");
  if (error) return { error: dbErrorMessage(error) };
  if (!count) return { error: "Séance introuvable, déjà annulée ou non autorisée." };
  revalidatePath("/schedule");
  return { ok: true, message: "Séance annulée." };
}

export async function bookMember(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize("bookings.manage", "schedule.manage_own");
  if (auth.denied) return auth.denied;
  const parsed = parseForm(z.object({ session_id: uuid, member_id: uuid }), formData);
  if (parsed.error) return parsed.error;
  const { error } = await auth.ctx.supabase.rpc("book_session", {
    p_org: auth.ctx.org.id, p_session: parsed.data.session_id, p_member: parsed.data.member_id,
  });
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/schedule");
  return { ok: true, message: "Membre inscrit." };
}

export async function updateBooking(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize("bookings.manage", "schedule.manage_own");
  if (auth.denied) return auth.denied;
  const parsed = parseForm(z.object({ booking_id: uuid, status: z.enum(["cancelled", "attended", "no_show"]) }), formData);
  if (parsed.error) return parsed.error;

  if (parsed.data.status === "cancelled") {
    const { error } = await auth.ctx.supabase.rpc("cancel_booking", { p_org: auth.ctx.org.id, p_booking: parsed.data.booking_id });
    if (error) return { error: dbErrorMessage(error) };
  } else {
    const { error, count } = await auth.ctx.supabase
      .from("bookings")
      .update({ status: parsed.data.status }, { count: "exact" })
      .eq("organization_id", auth.ctx.org.id)
      .eq("id", parsed.data.booking_id);
    if (error) return { error: dbErrorMessage(error) };
    if (!count) return { error: "Réservation introuvable ou non autorisée." };
  }
  revalidatePath("/schedule");
  return { ok: true, message: "Réservation mise à jour." };
}
