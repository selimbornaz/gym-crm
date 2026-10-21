import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/app/print-button";
import { requirePagePermission } from "@/lib/auth/context";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import type { PaymentRow } from "@/lib/types";
import { t } from "@/i18n";

export const metadata: Metadata = { title: "Reçu" };

/** Reçu de paiement imprimable (format A5 / ticket), en français. */
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePagePermission("payments.read");
  const db = ctx.supabase;

  const { data } = await db.from("payment_ledger").select("*").eq("organization_id", ctx.org.id).eq("id", id).maybeSingle();
  if (!data) notFound();
  const payment = data as PaymentRow;

  const [{ data: org }, { data: sub }, { data: adjustments }] = await Promise.all([
    db.from("organizations").select("name, legal_name, tax_id, address, phone, email, receipt_footer").eq("id", ctx.org.id).single(),
    payment.subscription_id
      ? db.from("subscription_overview").select("start_date, end_date, total_due, amount_paid, balance").eq("organization_id", ctx.org.id).eq("id", payment.subscription_id).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from("payment_adjustments").select("type, amount, reason, created_at").eq("organization_id", ctx.org.id).eq("payment_id", id).order("created_at"),
  ]);

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="no-print">
        <PrintButton label="Imprimer le reçu" />
      </div>

      <article className="w-full max-w-md rounded-xl border bg-white p-8 text-sm text-black shadow-sm print:border-0 print:shadow-none">
        <header className="border-b pb-4 text-center">
          <p className="text-lg font-semibold">{org?.name}</p>
          {org?.legal_name && <p>{org.legal_name}</p>}
          {org?.address && <p className="text-zinc-600">{org.address}</p>}
          <p className="text-zinc-600">{[org?.phone, org?.email].filter(Boolean).join(" · ")}</p>
          {org?.tax_id && <p className="text-zinc-600">Matricule fiscal : {org.tax_id}</p>}
        </header>

        <div className="py-4 text-center">
          <p className="text-xs uppercase tracking-widest text-zinc-500">Reçu de paiement</p>
          <p className="font-mono text-base font-semibold">{payment.receipt_number}</p>
          <p className="text-zinc-600">{formatDateTime(payment.paid_at)}</p>
        </div>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-y py-4">
          <dt className="text-zinc-500">Membre</dt>
          <dd className="text-right">{payment.member_name} ({payment.member_code})</dd>
          <dt className="text-zinc-500">Objet</dt>
          <dd className="text-right">
            {payment.plan_name ?? "Hors abonnement"}
            {sub && <span className="block text-xs text-zinc-500">du {formatDate(sub.start_date)} au {formatDate(sub.end_date)}</span>}
          </dd>
          <dt className="text-zinc-500">Mode de paiement</dt>
          <dd className="text-right">{payment.method_name}{payment.reference && ` (${payment.reference})`}</dd>
        </dl>

        <div className="flex items-baseline justify-between py-4">
          <span className="font-medium">Montant reçu</span>
          <span className="text-xl font-semibold tabular-nums">{formatMoney(payment.amount)}</span>
        </div>

        {(adjustments ?? []).length > 0 && (
          <div className="border-t py-3">
            {(adjustments as Array<{ type: "refund" | "reversal"; amount: number; reason: string; created_at: string }>).map((a, i) => (
              <p key={i} className="flex justify-between text-zinc-700">
                <span>{t.adjustmentType[a.type]} du {formatDate(a.created_at)}</span>
                <span className="tabular-nums">− {formatMoney(a.amount)}</span>
              </p>
            ))}
          </div>
        )}

        {sub && (
          <dl className="grid grid-cols-[1fr_auto] gap-y-1 border-t pt-3 text-zinc-700">
            <dt>Total de l&apos;abonnement</dt>
            <dd className="text-right tabular-nums">{formatMoney(sub.total_due)}</dd>
            <dt>Total réglé à ce jour</dt>
            <dd className="text-right tabular-nums">{formatMoney(sub.amount_paid)}</dd>
            <dt className="font-medium text-black">Reste à payer</dt>
            <dd className="text-right font-medium tabular-nums text-black">{formatMoney(sub.balance)}</dd>
          </dl>
        )}

        <footer className="mt-6 border-t pt-4 text-center text-xs text-zinc-500">
          <p>{org?.receipt_footer ?? "Merci de votre confiance."}</p>
          <p className="mt-1">Montants en dinars tunisiens (TND).</p>
        </footer>
      </article>
    </div>
  );
}
