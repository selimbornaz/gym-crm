"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authorize, dbErrorMessage, parseForm } from "@/lib/actions";
import type { ActionState } from "@/lib/action-state";
import { tunisLocalToIso } from "@/lib/format";
import { optionalText, phone, uuid } from "@/lib/validation";

const GOALS = ["weight_loss", "muscle_gain", "endurance", "wellness", "other"] as const;
const SOURCES = ["walk_in", "website", "social_media", "referral", "other"] as const;
const STATUSES = ["to_contact", "trial_scheduled", "trial_done", "won", "lost"] as const;

const leadSchema = z.object({
  lead_id: uuid.optional(),
  first_name: z.string().trim().min(1, "Prénom requis").max(80),
  last_name: z.string().trim().min(1, "Nom requis").max(80),
  phone,
  email: z.string().email("Email invalide").optional(),
  goal: z.enum(GOALS),
  source: z.enum(SOURCES),
  coach_id: uuid.optional(),
  notes: optionalText(2000),
});

export async function saveLead(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize("leads.manage");
  if (auth.denied) return auth.denied;
  const parsed = parseForm(leadSchema, formData);
  if (parsed.error) return parsed.error;
  const { lead_id, ...l } = parsed.data;
  const row = { ...l, email: l.email ?? null, coach_id: l.coach_id ?? null, notes: l.notes ?? null, last_activity_at: new Date().toISOString() };
  const db = auth.ctx.supabase.from("leads");
  const { error } = lead_id
    ? await db.update(row).eq("organization_id", auth.ctx.org.id).eq("id", lead_id)
    : await db.insert({ ...row, organization_id: auth.ctx.org.id });
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/leads");
  return { ok: true, message: lead_id ? "Prospect mis à jour." : `${l.first_name} ajouté(e) au tunnel.` };
}

const moveSchema = z.object({
  lead_id: uuid,
  status: z.enum(STATUSES),
  trial_at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Date invalide").optional(),
  coach_id: uuid.optional(),
  lost_reason: optionalText(300),
});

export async function moveLead(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize("leads.manage");
  if (auth.denied) return auth.denied;
  const parsed = parseForm(moveSchema, formData);
  if (parsed.error) return parsed.error;
  const d = parsed.data;
  if (d.status === "trial_scheduled" && !d.trial_at) return { fieldErrors: { trial_at: "Date de l'essai requise" } };

  const patch: Record<string, unknown> = { status: d.status, last_activity_at: new Date().toISOString() };
  if (d.status === "trial_scheduled") {
    patch.trial_at = tunisLocalToIso(d.trial_at!);
    if (d.coach_id) patch.coach_id = d.coach_id;
  }
  patch.lost_reason = d.status === "lost" ? (d.lost_reason ?? null) : null;

  const { error, count } = await auth.ctx.supabase
    .from("leads")
    .update(patch, { count: "exact" })
    .eq("organization_id", auth.ctx.org.id)
    .eq("id", d.lead_id)
    .is("converted_member_id", null);
  if (error) return { error: dbErrorMessage(error) };
  if (!count) return { error: "Prospect introuvable ou déjà converti en membre." };
  revalidatePath("/leads");
  return { ok: true };
}

/** Crée la fiche membre à partir du prospect (atomique côté base) puis ouvre la fiche. */
export async function convertLead(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize("leads.manage");
  if (auth.denied) return auth.denied;
  if (!auth.ctx.can("members.write")) return { error: "Vous n'êtes pas autorisé à créer des membres." };
  const id = uuid.safeParse(formData.get("lead_id"));
  if (!id.success) return { error: "Prospect invalide." };
  const { data, error } = await auth.ctx.supabase.rpc("convert_lead", { p_org: auth.ctx.org.id, p_lead: id.data });
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/leads");
  redirect(`/members/${data as string}?created=1`);
}

export async function deleteLead(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize("leads.manage");
  if (auth.denied) return auth.denied;
  const id = uuid.safeParse(formData.get("lead_id"));
  if (!id.success) return { error: "Prospect invalide." };
  const { error } = await auth.ctx.supabase.from("leads").delete().eq("organization_id", auth.ctx.org.id).eq("id", id.data);
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/leads");
  return { ok: true, message: "Prospect supprimé." };
}
