"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, dbErrorMessage, parseForm } from "@/lib/actions";
import type { ActionState } from "@/lib/action-state";
import { isoDate, optionalText, positiveAmount, uuid } from "@/lib/validation";

const CATEGORIES = ["rent", "electricity", "water", "equipment", "salaries", "maintenance", "marketing", "supplies", "taxes", "other"] as const;

const expenseSchema = z.object({
  expense_id: uuid.optional(),
  category: z.enum(CATEGORIES, { errorMap: () => ({ message: "Catégorie requise" }) }),
  amount: positiveAmount,
  spent_on: isoDate,
  description: z.string().trim().min(2, "Description requise").max(300),
  supplier: optionalText(120),
  payment_method_id: uuid.optional(),
});

export async function saveExpense(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize("expenses.manage");
  if (auth.denied) return auth.denied;
  const parsed = parseForm(expenseSchema, formData);
  if (parsed.error) return parsed.error;
  const { expense_id, ...e } = parsed.data;
  const row = { ...e, supplier: e.supplier ?? null, payment_method_id: e.payment_method_id ?? null };
  const db = auth.ctx.supabase.from("expenses");
  const { error } = expense_id
    ? await db.update(row).eq("organization_id", auth.ctx.org.id).eq("id", expense_id).is("voided_at", null)
    : await db.insert({ ...row, organization_id: auth.ctx.org.id });
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/expenses");
  revalidatePath("/reports");
  return { ok: true, message: expense_id ? "Dépense modifiée (journalisée)." : "Dépense enregistrée." };
}

/** Une dépense ne se supprime pas : elle s'annule avec un motif (trace conservée). */
export async function voidExpense(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize("expenses.manage");
  if (auth.denied) return auth.denied;
  const parsed = parseForm(z.object({ expense_id: uuid, reason: z.string().trim().min(3, "Motif obligatoire").max(300) }), formData);
  if (parsed.error) return parsed.error;
  const { error, count } = await auth.ctx.supabase
    .from("expenses")
    .update({ voided_at: new Date().toISOString(), void_reason: parsed.data.reason }, { count: "exact" })
    .eq("organization_id", auth.ctx.org.id)
    .eq("id", parsed.data.expense_id)
    .is("voided_at", null);
  if (error) return { error: dbErrorMessage(error) };
  if (!count) return { error: "Dépense introuvable ou déjà annulée." };
  revalidatePath("/expenses");
  revalidatePath("/reports");
  return { ok: true, message: "Dépense annulée." };
}
