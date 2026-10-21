"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, dbErrorMessage, parseForm } from "@/lib/actions";
import type { ActionState } from "@/lib/action-state";
import { amount, isoDate, optionalText, uuid } from "@/lib/validation";

const equipmentSchema = z.object({
  equipment_id: uuid.optional(),
  name: z.string().trim().min(2, "Nom requis").max(120),
  category: z.string().trim().min(1, "Catégorie requise").max(60),
  quantity: z.coerce.number().int().min(0, "Quantité invalide").max(10_000),
  purchase_date: isoDate.optional(),
  purchase_cost: amount.optional(),
  condition: z.enum(["new", "good", "fair", "poor", "out_of_service"]),
  location: optionalText(80),
  next_maintenance_on: isoDate.optional(),
  notes: optionalText(1000),
});

export async function saveEquipment(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize("equipment.manage");
  if (auth.denied) return auth.denied;
  const parsed = parseForm(equipmentSchema, formData);
  if (parsed.error) return parsed.error;
  const { equipment_id, ...e } = parsed.data;
  const row = {
    ...e,
    purchase_date: e.purchase_date ?? null,
    purchase_cost: e.purchase_cost ?? null,
    location: e.location ?? null,
    next_maintenance_on: e.next_maintenance_on ?? null,
    notes: e.notes ?? null,
  };
  const db = auth.ctx.supabase.from("equipment");
  const { error } = equipment_id
    ? await db.update(row).eq("organization_id", auth.ctx.org.id).eq("id", equipment_id)
    : await db.insert({ ...row, organization_id: auth.ctx.org.id });
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/equipment");
  return { ok: true, message: equipment_id ? "Équipement mis à jour." : "Équipement ajouté." };
}

export async function logMaintenance(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize("equipment.manage");
  if (auth.denied) return auth.denied;
  const parsed = parseForm(
    z.object({
      equipment_id: uuid,
      performed_on: isoDate,
      description: z.string().trim().min(2, "Description requise").max(500),
      cost: amount.optional(),
      performed_by: optionalText(120),
      next_due_on: isoDate.optional(),
    }),
    formData,
  );
  if (parsed.error) return parsed.error;
  const d = parsed.data;
  const { error } = await auth.ctx.supabase.from("equipment_maintenance").insert({
    organization_id: auth.ctx.org.id, equipment_id: d.equipment_id, performed_on: d.performed_on, description: d.description,
    cost: d.cost ?? null, performed_by: d.performed_by ?? null, next_due_on: d.next_due_on ?? null,
  });
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/equipment");
  return { ok: true, message: "Maintenance enregistrée." };
}

export async function archiveEquipment(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize("equipment.manage");
  if (auth.denied) return auth.denied;
  const id = uuid.safeParse(formData.get("equipment_id"));
  if (!id.success) return { error: "Équipement invalide." };
  const { error } = await auth.ctx.supabase
    .from("equipment")
    .update({ archived_at: new Date().toISOString() })
    .eq("organization_id", auth.ctx.org.id)
    .eq("id", id.data);
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/equipment");
  return { ok: true, message: "Équipement retiré de l'inventaire (historique conservé)." };
}
