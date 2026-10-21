"use client";

import { useState, type ReactNode } from "react";
import { ActionDialog } from "@/components/app/action-dialog";
import { RequestId } from "@/components/app/request-id";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatMoney, isoToTunisLocal } from "@/lib/format";
import type { PaymentMethodRow, PaymentRow, PlanRow, SubscriptionRow } from "@/lib/types";
import { t } from "@/i18n";
import { createSubscription, manageSubscription, recordPayment, refundPayment } from "./actions";

function planLabel(p: PlanRow) {
  return `${p.name} — ${formatMoney(p.price)} (${p.duration_value} ${t.durationUnit[p.duration_unit]})`;
}

// -----------------------------------------------------------------------------
// Nouvel abonnement / renouvellement
// -----------------------------------------------------------------------------
export function NewSubscriptionDialog({
  trigger,
  memberId,
  plans,
  methods,
  canPay,
}: {
  trigger: ReactNode;
  memberId: string;
  plans: PlanRow[];
  methods: PaymentMethodRow[];
  canPay: boolean;
}) {
  return (
    <ActionDialog
      trigger={trigger}
      title="Nouvel abonnement"
      description="Sans date de début, un renouvellement démarre le lendemain de l'abonnement en cours."
      action={createSubscription}
      submitLabel="Enregistrer"
    >
      {(state) => <SubscriptionFields state={state} memberId={memberId} plans={plans} methods={methods} canPay={canPay} />}
    </ActionDialog>
  );
}

function SubscriptionFields({
  state,
  memberId,
  plans,
  methods,
  canPay,
}: {
  state: { fieldErrors?: Record<string, string> };
  memberId: string;
  plans: PlanRow[];
  methods: PaymentMethodRow[];
  canPay: boolean;
}) {
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const plan = plans.find((p) => p.id === planId);
  const e = state.fieldErrors ?? {};

  return (
    <>
      <input type="hidden" name="member_id" value={memberId} />
      <RequestId />
      <RequestId name="pay_request_id" />
      <Field label="Formule" htmlFor="plan_id" error={e.plan_id} required>
        <NativeSelect id="plan_id" name="plan_id" value={planId} onChange={(ev) => setPlanId(ev.target.value)}>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {planLabel(p)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {plan?.access_restrictions && <p className="text-xs text-muted-foreground">Restriction : {plan.access_restrictions}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date de début (optionnel)" htmlFor="start_date" error={e.start_date}>
          <Input id="start_date" name="start_date" type="date" />
        </Field>
        <Field label="Remise (TND)" htmlFor="discount" error={e.discount} hint="Promotion, geste commercial…">
          <Input id="discount" name="discount" inputMode="decimal" placeholder="0" />
        </Field>
      </div>
      <Field label="Notes" htmlFor="notes" error={e.notes}>
        <Input id="notes" name="notes" placeholder="Ex. offre parrainage" />
      </Field>
      {canPay && (
        <fieldset className="grid gap-4 rounded-lg border p-3 sm:grid-cols-2">
          <legend className="px-1 text-sm font-medium">Encaisser maintenant (optionnel)</legend>
          <Field label="Montant (TND)" htmlFor="pay_now" error={e.pay_now} hint={plan ? `Prix : ${formatMoney(plan.price)}` : undefined}>
            <Input id="pay_now" name="pay_now" inputMode="decimal" placeholder="0" />
          </Field>
          <Field label="Moyen de paiement" htmlFor="method_id" error={e.method_id}>
            <NativeSelect id="method_id" name="method_id" defaultValue={methods[0]?.id}>
              {methods.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </fieldset>
      )}
    </>
  );
}

// -----------------------------------------------------------------------------
// Actions propriétaire sur un abonnement
// -----------------------------------------------------------------------------
export function SubscriptionManageButtons({ sub }: { sub: SubscriptionRow }) {
  const hidden = (op: string) => (
    <>
      <input type="hidden" name="member_id" value={sub.member_id} />
      <input type="hidden" name="subscription_id" value={sub.id} />
      <input type="hidden" name="operation" value={op} />
    </>
  );
  const reasonField = (error?: string, placeholder?: string) => (
    <Field label="Motif" htmlFor={`reason-${sub.id}`} error={error} required>
      <Textarea id={`reason-${sub.id}`} name="reason" rows={2} placeholder={placeholder} />
    </Field>
  );
  if (sub.status === "cancelled") return null;

  return (
    <div className="flex flex-wrap justify-end gap-1">
      <ActionDialog
        trigger={<Button size="sm" variant="ghost">Prolonger</Button>}
        title="Prolonger l'abonnement"
        description={`Fin actuelle : ${formatDate(sub.end_date)}. L'opération est tracée dans le journal d'audit.`}
        action={manageSubscription}
        submitLabel="Prolonger"
      >
        {(s) => (
          <>
            {hidden("extend")}
            <Field label="Nombre de jours" htmlFor={`days-${sub.id}`} error={s.fieldErrors?.days} required>
              <Input id={`days-${sub.id}`} name="days" type="number" min={1} max={365} defaultValue={7} />
            </Field>
            {reasonField(s.fieldErrors?.reason, "Ex. fermeture pour travaux")}
          </>
        )}
      </ActionDialog>

      {sub.status === "suspended" ? (
        <ActionDialog
          trigger={<Button size="sm" variant="ghost">Réactiver</Button>}
          title="Réactiver l'abonnement"
          description="La date de fin est repoussée du nombre de jours de suspension."
          action={manageSubscription}
          submitLabel="Réactiver"
        >
          {() => hidden("resume")}
        </ActionDialog>
      ) : (
        sub.effective_status === "active" && (
          <ActionDialog
            trigger={<Button size="sm" variant="ghost">Suspendre</Button>}
            title="Suspendre l'abonnement"
            description="Gel temporaire (blessure, voyage…). L'accès est bloqué jusqu'à la reprise."
            action={manageSubscription}
            submitLabel="Suspendre"
          >
            {(s) => (
              <>
                {hidden("suspend")}
                {reasonField(s.fieldErrors?.reason, "Ex. blessure au genou")}
              </>
            )}
          </ActionDialog>
        )
      )}

      <ActionDialog
        trigger={<Button size="sm" variant="ghost" className="text-danger">Annuler</Button>}
        title="Annuler l'abonnement ?"
        description="L'abonnement reste dans l'historique. Les paiements éventuels ne sont pas remboursés automatiquement."
        action={manageSubscription}
        submitLabel="Annuler l'abonnement"
        destructive
      >
        {(s) => (
          <>
            {hidden("cancel")}
            {reasonField(s.fieldErrors?.reason)}
          </>
        )}
      </ActionDialog>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Encaissement
// -----------------------------------------------------------------------------
export function RecordPaymentDialog({
  trigger,
  memberId,
  subscriptions,
  methods,
  canBackdate,
  defaultSubscriptionId,
}: {
  trigger: ReactNode;
  memberId: string;
  subscriptions: Pick<SubscriptionRow, "id" | "plan_name" | "start_date" | "end_date" | "balance">[];
  methods: PaymentMethodRow[];
  canBackdate: boolean;
  defaultSubscriptionId?: string;
}) {
  return (
    <ActionDialog trigger={trigger} title="Encaisser un paiement" action={recordPayment} submitLabel="Encaisser">
      {(state) => (
        <PaymentFields
          state={state}
          memberId={memberId}
          subscriptions={subscriptions}
          methods={methods}
          canBackdate={canBackdate}
          defaultSubscriptionId={defaultSubscriptionId}
        />
      )}
    </ActionDialog>
  );
}

function PaymentFields({
  state,
  memberId,
  subscriptions,
  methods,
  canBackdate,
  defaultSubscriptionId,
}: {
  state: { fieldErrors?: Record<string, string> };
  memberId: string;
  subscriptions: Pick<SubscriptionRow, "id" | "plan_name" | "start_date" | "end_date" | "balance">[];
  methods: PaymentMethodRow[];
  canBackdate: boolean;
  defaultSubscriptionId?: string;
}) {
  const [subId, setSubId] = useState(defaultSubscriptionId ?? subscriptions[0]?.id ?? "");
  const sub = subscriptions.find((s) => s.id === subId);
  const e = state.fieldErrors ?? {};

  return (
    <>
      <input type="hidden" name="member_id" value={memberId} />
      <RequestId />
      <Field label="Affecter à" htmlFor="subscription_id" error={e.subscription_id}>
        <NativeSelect id="subscription_id" name="subscription_id" value={subId} onChange={(ev) => setSubId(ev.target.value)}>
          {subscriptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.plan_name} ({formatDate(s.start_date)} → {formatDate(s.end_date)}) — reste {formatMoney(s.balance)}
            </option>
          ))}
          <option value="">Hors abonnement (vente, frais…)</option>
        </NativeSelect>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Montant (TND)" htmlFor="amount" error={e.amount} required>
          <Input id="amount" name="amount" inputMode="decimal" key={subId} defaultValue={sub ? String(sub.balance) : ""} />
        </Field>
        <Field label="Moyen de paiement" htmlFor="pay_method" error={e.method_id} required>
          <NativeSelect id="pay_method" name="method_id" defaultValue={methods[0]?.id}>
            {methods.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <Field label="Référence (optionnel)" htmlFor="reference" error={e.reference} hint="N° de virement, de chèque, de ticket TPE…">
        <Input id="reference" name="reference" />
      </Field>
      {canBackdate && (
        <Field label="Date d'encaissement (si antérieure)" htmlFor="paid_at" error={e.paid_at}>
          <Input id="paid_at" name="paid_at" type="datetime-local" max={isoToTunisLocal(new Date().toISOString())} />
        </Field>
      )}
      <Field label="Notes" htmlFor="pay_notes" error={e.notes}>
        <Input id="pay_notes" name="notes" />
      </Field>
    </>
  );
}

// -----------------------------------------------------------------------------
// Remboursement / annulation
// -----------------------------------------------------------------------------
export function RefundDialog({ payment }: { payment: Pick<PaymentRow, "id" | "member_id" | "amount" | "refunded_amount" | "receipt_number"> }) {
  const remaining = Number(payment.amount) - Number(payment.refunded_amount);
  if (remaining <= 0) return null;
  return (
    <ActionDialog
      trigger={<Button size="sm" variant="ghost">Rembourser</Button>}
      title={`Rembourser le reçu ${payment.receipt_number}`}
      description={`Remboursable : ${formatMoney(remaining)}. Le paiement d'origine reste dans l'historique ; l'opération est journalisée.`}
      action={refundPayment}
      submitLabel="Valider"
      destructive
    >
      {(state) => <RefundFields state={state} payment={payment} remaining={remaining} />}
    </ActionDialog>
  );
}

function RefundFields({
  state,
  payment,
  remaining,
}: {
  state: { fieldErrors?: Record<string, string> };
  payment: Pick<PaymentRow, "id" | "member_id">;
  remaining: number;
}) {
  const [type, setType] = useState<"refund" | "reversal">("refund");
  const e = state.fieldErrors ?? {};
  return (
    <>
      <input type="hidden" name="payment_id" value={payment.id} />
      <input type="hidden" name="member_id" value={payment.member_id} />
      <RequestId />
      <Field label="Type" htmlFor="type">
        <NativeSelect id="type" name="type" value={type} onChange={(ev) => setType(ev.target.value as "refund" | "reversal")}>
          <option value="refund">{t.adjustmentType.refund} partiel ou total</option>
          <option value="reversal">{t.adjustmentType.reversal} (erreur de saisie : tout le restant)</option>
        </NativeSelect>
      </Field>
      {type === "refund" && (
        <Field label="Montant (TND)" htmlFor="refund_amount" error={e.amount} required>
          <Input id="refund_amount" name="amount" inputMode="decimal" defaultValue={remaining.toFixed(3)} />
        </Field>
      )}
      <Field label="Motif" htmlFor="refund_reason" error={e.reason} required>
        <Textarea id="refund_reason" name="reason" rows={2} />
      </Field>
    </>
  );
}
