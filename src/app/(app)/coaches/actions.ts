"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, dbErrorMessage, parseForm } from "@/lib/actions";
import type { ActionState } from "@/lib/action-state";
import { optionalText, phone, uuid } from "@/lib/validation";

const SLOT = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;

/** "08:00-12:00, 17:00-21:00" (une ligne par jour) -> [{day, start, end}] */
function parseAvailability(formData: FormData): { slots: Array<{ day: number; start: string; end: string }>; error?: string } {
  const slots: Array<{ day: number; start: string; end: string }> = [];
  for (let day = 1; day <= 7; day++) {
    const raw = String(formData.get(`avail_${day}`) ?? "").trim();
    if (!raw) continue;
    for (const part of raw.split(",").map((p) => p.replace(/\s/g, ""))) {
      if (!SLOT.test(part)) return { slots, error: `Créneau invalide « ${part} » (format 08:00-12:00)` };
      const [start, end] = part.split("-") as [string, string];
      if (end <= start) return { slots, error: `Créneau invalide « ${part} » : la fin doit suivre le début` };
      slots.push({ day, start, end });
    }
  }
  return { slots };
}

const coachSchema = z.object({
  coach_id: uuid.optional(),
  full_name: z.string().trim().min(2, "Nom requis").max(120),
  phone: phone.optional(),
  email: z.string().email("Email invalide").optional(),
  specialties: optionalText(300),
  bio: optionalText(1000),
  is_active: z.literal("on").optional(),
});

export async function saveCoach(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize("coaches.manage");
  if (auth.denied) return auth.denied;
  const parsed = parseForm(coachSchema, formData);
  if (parsed.error) return parsed.error;
  const availability = parseAvailability(formData);
  if (availability.error) return { fieldErrors: { availability: availability.error } };

  const d = parsed.data;
  const row = {
    full_name: d.full_name,
    phone: d.phone ?? null,
    email: d.email ?? null,
    bio: d.bio ?? null,
    specialties: (d.specialties ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 12),
    availability: availability.slots,
    is_active: d.is_active === "on",
  };
  const db = auth.ctx.supabase.from("coaches");
  const { error } = d.coach_id
    ? await db.update(row).eq("organization_id", auth.ctx.org.id).eq("id", d.coach_id)
    : await db.insert({ ...row, organization_id: auth.ctx.org.id });
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/coaches");
  return { ok: true, message: d.coach_id ? "Fiche coach mise à jour." : "Coach ajouté." };
}
