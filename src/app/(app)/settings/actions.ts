"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, dbErrorMessage, parseForm } from "@/lib/actions";
import type { ActionState } from "@/lib/action-state";
import { amount, optionalText, uuid } from "@/lib/validation";

const orgSchema = z.object({
  name: z.string().trim().min(2, "Nom requis").max(120),
  legal_name: optionalText(160),
  tax_id: optionalText(40),
  address: optionalText(300),
  phone: optionalText(40),
  email: z.string().email("Email invalide").optional(),
  receipt_footer: optionalText(300),
});

export async function updateOrganization(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize("settings.manage");
  if (auth.denied) return auth.denied;
  const parsed = parseForm(orgSchema, formData);
  if (parsed.error) return parsed.error;
  const d = parsed.data;
  const { error } = await auth.ctx.supabase
    .from("organizations")
    .update({
      name: d.name, legal_name: d.legal_name ?? null, tax_id: d.tax_id ?? null, address: d.address ?? null,
      phone: d.phone ?? null, email: d.email ?? null, receipt_footer: d.receipt_footer ?? null,
    })
    .eq("id", auth.ctx.org.id);
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/", "layout");
  return { ok: true, message: "Informations de la salle enregistrées." };
}

const NOTIFY_TYPES = [
  "membership_expiring", "membership_expired", "unpaid_balance", "upcoming_session", "new_member", "announcement", "equipment_maintenance",
] as const;

const settingsSchema = z.object({
  expiry_alert_days: z.coerce.number().int().min(1, "Entre 1 et 60").max(60, "Entre 1 et 60"),
  checkin_debounce_minutes: z.coerce.number().int().min(0, "Entre 0 et 240").max(240, "Entre 0 et 240"),
  receipt_prefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,8}$/, "1 à 8 caractères (A-Z, 0-9, -)"),
  member_code_prefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,8}$/, "1 à 8 caractères (A-Z, 0-9, -)"),
  notify_types: z.array(z.enum(NOTIFY_TYPES)).optional(),
});

export async function updateSettings(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize("settings.manage");
  if (auth.denied) return auth.denied;
  const parsed = parseForm(settingsSchema, formData);
  if (parsed.error) return parsed.error;
  const { error } = await auth.ctx.supabase
    .from("organization_settings")
    .update({ ...parsed.data, notify_types: parsed.data.notify_types ?? [] })
    .eq("organization_id", auth.ctx.org.id);
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/settings");
  return { ok: true, message: "Paramètres enregistrés." };
}

const planSchema = z
  .object({
    plan_id: uuid.optional(),
    name: z.string().trim().min(2, "Nom requis").max(80),
    kind: z.enum(["membership", "pass", "pt_package"]),
    duration_value: z.coerce.number().int().min(1, "Durée invalide").max(1000),
    duration_unit: z.enum(["day", "week", "month", "year"]),
    sessions_included: z.coerce.number().int().min(1).max(500).optional(),
    price: amount,
    description: optionalText(500),
    access_restrictions: optionalText(200),
    sort_order: z.coerce.number().int().min(0).max(999).optional(),
    is_active: z.literal("on").optional(),
  })
  .refine((p) => p.kind !== "pt_package" || p.sessions_included, {
    message: "Nombre de séances requis pour un pack coaching",
    path: ["sessions_included"],
  });

export async function savePlan(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize("plans.manage");
  if (auth.denied) return auth.denied;
  const parsed = parseForm(planSchema, formData);
  if (parsed.error) return parsed.error;
  const { plan_id, is_active, ...p } = parsed.data;
  const row = {
    ...p,
    sessions_included: p.kind === "pt_package" ? p.sessions_included : null,
    description: p.description ?? null,
    access_restrictions: p.access_restrictions ?? null,
    sort_order: p.sort_order ?? 0,
    is_active: is_active === "on",
  };
  const db = auth.ctx.supabase.from("membership_plans");
  const { error } = plan_id
    ? await db.update(row).eq("organization_id", auth.ctx.org.id).eq("id", plan_id)
    : await db.insert({ ...row, organization_id: auth.ctx.org.id });
  if (error) return { error: error.code === "23505" ? "Une formule porte déjà ce nom." : dbErrorMessage(error) };
  revalidatePath("/settings");
  return { ok: true, message: plan_id ? "Formule mise à jour (les abonnements existants gardent leur prix)." : "Formule créée." };
}

const methodSchema = z.object({
  method_id: uuid.optional(),
  name: z.string().trim().min(2, "Nom requis").max(60),
  is_active: z.literal("on").optional(),
});

export async function savePaymentMethod(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize("payment_methods.manage");
  if (auth.denied) return auth.denied;
  const parsed = parseForm(methodSchema, formData);
  if (parsed.error) return parsed.error;
  const row = { name: parsed.data.name, is_active: parsed.data.is_active === "on" };
  const db = auth.ctx.supabase.from("payment_methods");
  const { error } = parsed.data.method_id
    ? await db.update(row).eq("organization_id", auth.ctx.org.id).eq("id", parsed.data.method_id)
    : await db.insert({ ...row, organization_id: auth.ctx.org.id, code: "other" });
  if (error) return { error: error.code === "23505" ? "Ce moyen de paiement existe déjà." : dbErrorMessage(error) };
  revalidatePath("/settings");
  return { ok: true, message: "Moyen de paiement enregistré." };
}
