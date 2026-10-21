"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, dbErrorMessage, parseForm } from "@/lib/actions";
import type { ActionState } from "@/lib/action-state";
import { tunisLocalToIso } from "@/lib/format";
import { amount, isoDate, optionalText, positiveAmount, uuid } from "@/lib/validation";

function refreshMemberViews(memberId: string) {
  revalidatePath(`/members/${memberId}`);
  revalidatePath("/subscriptions");
  revalidatePath("/payments");
  revalidatePath("/dashboard");
}

// -----------------------------------------------------------------------------
// Abonnements
// -----------------------------------------------------------------------------

const createSubscriptionSchema = z.object({
  member_id: uuid,
  plan_id: uuid,
  request_id: uuid,
  start_date: isoDate.optional(),
  discount: amount.optional(),
  notes: optionalText(500),
  pay_now: amount.optional(),
  method_id: uuid.optional(),
  pay_request_id: uuid.optional(),
});

/**
 * Crée ou renouvelle un abonnement, et encaisse éventuellement un premier
 * paiement. Les deux opérations sont idempotentes (request_id distincts) :
 * un double clic ou un retry réseau ne crée ni doublon ni double encaissement.
 */
export async function createSubscription(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize("subscriptions.write");
  if (auth.denied) return auth.denied;
  const { ctx } = auth;
  const parsed = parseForm(createSubscriptionSchema, formData);
  if (parsed.error) return parsed.error;
  const input = parsed.data;
  const payNow = input.pay_now && Number(input.pay_now) > 0 ? input.pay_now : null;
  if (payNow && !input.method_id) return { fieldErrors: { method_id: "Choisissez le moyen de paiement" } };
  if (payNow && !ctx.can("payments.create")) return { error: "Vous n'êtes pas autorisé à encaisser." };

  const { data: subId, error } = await ctx.supabase.rpc("create_subscription", {
    p_org: ctx.org.id,
    p_member: input.member_id,
    p_plan: input.plan_id,
    p_request_id: input.request_id,
    p_start: input.start_date ?? null,
    p_discount: input.discount ?? "0",
    p_notes: input.notes ?? null,
  });
  if (error) return { error: dbErrorMessage(error) };

  let message = "Abonnement enregistré.";
  if (payNow) {
    const { data: pay, error: payError } = await ctx.supabase.rpc("record_payment", {
      p_org: ctx.org.id,
      p_member: input.member_id,
      p_method: input.method_id,
      p_amount: payNow,
      p_request_id: input.pay_request_id ?? crypto.randomUUID(),
      p_subscription: subId,
    });
    refreshMemberViews(input.member_id);
    if (payError) {
      return { ok: true, message: `Abonnement enregistré, mais paiement refusé : ${dbErrorMessage(payError)}` };
    }
    const receipt = (pay as Array<{ receipt_number: string }>)[0]?.receipt_number;
    message = `Abonnement enregistré et paiement encaissé (reçu ${receipt}).`;
  }

  refreshMemberViews(input.member_id);
  return { ok: true, message, data: { subscriptionId: subId } };
}

const subscriptionActionSchema = z.object({
  member_id: uuid,
  subscription_id: uuid,
  operation: z.enum(["suspend", "resume", "cancel", "extend"]),
  reason: optionalText(300),
  days: z.coerce.number().int().min(1, "1 jour minimum").max(365, "365 jours maximum").optional(),
});

/** Suspension, reprise, annulation, prolongation : réservées à `subscriptions.manage`. */
export async function manageSubscription(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize("subscriptions.manage");
  if (auth.denied) return auth.denied;
  const { ctx } = auth;
  const parsed = parseForm(subscriptionActionSchema, formData);
  if (parsed.error) return parsed.error;
  const { operation, subscription_id: sub, reason, days, member_id } = parsed.data;

  if (operation !== "resume" && (!reason || reason.length < 3)) return { fieldErrors: { reason: "Motif obligatoire (3 caractères min.)" } };
  if (operation === "extend" && !days) return { fieldErrors: { days: "Nombre de jours requis" } };

  const base = { p_org: ctx.org.id, p_sub: sub };
  const call =
    operation === "suspend"
      ? ctx.supabase.rpc("suspend_subscription", { ...base, p_reason: reason })
      : operation === "resume"
        ? ctx.supabase.rpc("resume_subscription", { ...base, p_reason: reason ?? null })
        : operation === "cancel"
          ? ctx.supabase.rpc("cancel_subscription", { ...base, p_reason: reason })
          : ctx.supabase.rpc("extend_subscription", { ...base, p_days: days, p_reason: reason });

  const { data, error } = await call;
  if (error) return { error: dbErrorMessage(error) };

  refreshMemberViews(member_id);
  const messages = {
    suspend: "Abonnement suspendu.",
    resume: `Abonnement réactivé${typeof data === "number" && data > 0 ? ` (+${data} jour${data > 1 ? "s" : ""})` : ""}.`,
    cancel: "Abonnement annulé (historique conservé).",
    extend: `Abonnement prolongé de ${days} jour${days && days > 1 ? "s" : ""}.`,
  };
  return { ok: true, message: messages[operation] };
}

// -----------------------------------------------------------------------------
// Paiements
// -----------------------------------------------------------------------------

const paymentSchema = z.object({
  member_id: uuid,
  subscription_id: uuid.optional(),
  method_id: uuid,
  amount: positiveAmount,
  request_id: uuid,
  reference: optionalText(120),
  notes: optionalText(500),
  paid_at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Date invalide").optional(),
});

export async function recordPayment(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize("payments.create");
  if (auth.denied) return auth.denied;
  const { ctx } = auth;
  const parsed = parseForm(paymentSchema, formData);
  if (parsed.error) return parsed.error;
  const input = parsed.data;

  const { data, error } = await ctx.supabase.rpc("record_payment", {
    p_org: ctx.org.id,
    p_member: input.member_id,
    p_method: input.method_id,
    p_amount: input.amount,
    p_request_id: input.request_id,
    p_subscription: input.subscription_id ?? null,
    p_paid_at: input.paid_at ? tunisLocalToIso(input.paid_at) : null,
    p_reference: input.reference ?? null,
    p_notes: input.notes ?? null,
  });
  if (error) return { error: dbErrorMessage(error) };

  const row = (data as Array<{ payment_id: string; receipt_number: string }>)[0];
  refreshMemberViews(input.member_id);
  return { ok: true, message: `Paiement encaissé — reçu ${row?.receipt_number}.`, data: { paymentId: row?.payment_id } };
}

const refundSchema = z.object({
  payment_id: uuid,
  member_id: uuid,
  type: z.enum(["refund", "reversal"]),
  amount: amount.optional(),
  reason: z.string().trim().min(3, "Motif obligatoire (3 caractères min.)").max(300),
  request_id: uuid,
});

/** Remboursement / annulation : le paiement d'origine n'est jamais modifié ni supprimé. */
export async function refundPayment(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize("payments.refund");
  if (auth.denied) return auth.denied;
  const parsed = parseForm(refundSchema, formData);
  if (parsed.error) return parsed.error;
  const input = parsed.data;
  if (input.type === "refund" && (!input.amount || Number(input.amount) <= 0)) return { fieldErrors: { amount: "Montant requis" } };

  const { error } = await auth.ctx.supabase.rpc("refund_payment", {
    p_org: auth.ctx.org.id,
    p_payment: input.payment_id,
    p_type: input.type,
    p_amount: input.type === "refund" ? input.amount : null,
    p_reason: input.reason,
    p_request_id: input.request_id,
  });
  if (error) return { error: dbErrorMessage(error) };
  refreshMemberViews(input.member_id);
  return { ok: true, message: input.type === "reversal" ? "Paiement annulé (contre-passation enregistrée)." : "Remboursement enregistré." };
}
