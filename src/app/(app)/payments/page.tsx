import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownLeft, Banknote, CreditCard, Hash, Undo2 } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { MetricStrip } from "@/components/app/metric-strip";
import { PageHeader } from "@/components/app/page-header";
import { Pagination, pageRange } from "@/components/app/pagination";
import { InitialsAvatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { requirePagePermission } from "@/lib/auth/context";
import { addDaysIso, formatDate, formatDateTime, formatMoney, sumAmounts, todayInTunis, tunisLocalToIso } from "@/lib/format";
import type { PaymentMethodRow, PaymentRow } from "@/lib/types";
import { RefundDialog } from "../billing/dialogs";

export const metadata: Metadata = { title: "Paiements" };

type SP = { from?: string; to?: string; method?: string; page?: string };
const isDate = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await requirePagePermission("payments.read");
  const today = todayInTunis();
  const fromDate = isDate(sp.from) ? sp.from! : addDaysIso(today, -30);
  const toDate = isDate(sp.to) ? sp.to! : today;
  const { page, from, to } = pageRange(sp.page);

  let query = ctx.supabase
    .from("payment_ledger")
    .select("*", { count: "exact" })
    .eq("organization_id", ctx.org.id)
    .gte("paid_at", tunisLocalToIso(`${fromDate}T00:00`))
    .lt("paid_at", tunisLocalToIso(`${addDaysIso(toDate, 1)}T00:00`));
  if (sp.method && /^[0-9a-f-]{36}$/.test(sp.method)) query = query.eq("method_id", sp.method);

  const [{ data, count }, { data: methods }, { data: totals }] = await Promise.all([
    query.order("paid_at", { ascending: false }).range(from, to),
    ctx.supabase.from("payment_methods").select("id, name, code, is_active").eq("organization_id", ctx.org.id).order("name"),
    // Totaux calculés en SQL (pas d'arithmétique flottante côté application).
    ctx.can("reports.financial")
      ? ctx.supabase.rpc("revenue_report", { p_org: ctx.org.id, p_from: fromDate, p_to: toDate, p_granularity: "year" })
      : Promise.resolve({ data: null }),
  ]);
  const rows = (data ?? []) as PaymentRow[];
  const periods = (totals ?? []) as Array<{ gross: number; refunds: number; net: number; payments_count: number }>;
  const summary = {
    gross: sumAmounts(periods.map((r) => r.gross)),
    refunds: sumAmounts(periods.map((r) => r.refunds)),
    net: sumAmounts(periods.map((r) => r.net)),
    n: periods.reduce((acc, r) => acc + Number(r.payments_count), 0),
  };

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6">
      <PageHeader
        title="Paiements"
        description={`Du ${formatDate(fromDate)} au ${formatDate(toDate)} · un paiement ne se supprime jamais : il se rembourse ou s'annule.`}
      />

      {/* Barre de filtres --------------------------------------------------------- */}
      <form method="get" className="edge-highlight flex flex-wrap items-center gap-2 rounded-xl border bg-card p-2 shadow-card">
        <label htmlFor="from" className="pl-2 text-eyebrow">Période</label>
        <Input id="from" name="from" type="date" defaultValue={fromDate} className="h-8 w-auto shadow-none" aria-label="Du" />
        <span className="text-subtle-foreground">→</span>
        <Input id="to" name="to" type="date" defaultValue={toDate} className="h-8 w-auto shadow-none" aria-label="Au" />
        <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden />
        <NativeSelect id="method" name="method" defaultValue={sp.method ?? ""} className="h-8 w-auto shadow-none" aria-label="Moyen de paiement">
          <option value="">Tous les moyens</option>
          {((methods ?? []) as PaymentMethodRow[]).map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </NativeSelect>
        <Button type="submit" size="sm" className="ml-auto">Appliquer</Button>
      </form>

      {totals && (
        <MetricStrip
          metrics={[
            { label: "Encaissé brut", icon: Banknote, value: formatMoney(summary.gross) },
            { label: "Remboursé", icon: Undo2, value: formatMoney(summary.refunds), tone: Number(summary.refunds) > 0 ? "warning" : undefined },
            { label: "Net", icon: ArrowDownLeft, value: formatMoney(summary.net), tone: "success" },
            { label: "Paiements", icon: Hash, value: summary.n },
          ]}
        />
      )}

      {rows.length === 0 ? (
        <EmptyState icon={CreditCard} title="Aucun paiement sur la période" description="Les paiements s'enregistrent depuis la fiche d'un membre." />
      ) : (
        <>
          <Table>
            <THead>
              <tr><Th>Reçu</Th><Th>Membre</Th><Th>Affectation</Th><Th>Moyen</Th><Th>Date</Th><Th className="text-right">Montant</Th><Th /></tr>
            </THead>
            <TBody>
              {rows.map((p) => {
                const refunded = Number(p.refunded_amount) > 0;
                const fully = Number(p.refunded_amount) >= Number(p.amount);
                return (
                  <Tr key={p.id}>
                    <Td>
                      <Link
                        href={`/payments/${p.id}/receipt`}
                        className="rounded-md border bg-secondary/60 px-1.5 py-0.5 font-mono text-[11px] transition-all duration-300 ease-out hover:border-border-strong hover:bg-accent"
                      >
                        {p.receipt_number}
                      </Link>
                    </Td>
                    <Td>
                      <Link href={`/members/${p.member_id}`} className="group flex items-center gap-2.5">
                        <InitialsAvatar name={p.member_name} className="size-6 text-[9px]" />
                        <span className="truncate font-medium transition-colors duration-300 ease-out group-hover:underline">{p.member_name}</span>
                      </Link>
                    </Td>
                    <Td>{p.plan_name ?? <span className="text-subtle-foreground">Hors abonnement</span>}</Td>
                    <Td>
                      <Badge variant="outline">{p.method_name}</Badge>
                      {p.reference && <span className="ml-1.5 font-mono text-[11px] text-subtle-foreground">{p.reference}</span>}
                    </Td>
                    <Td className="whitespace-nowrap tabular-nums text-muted-foreground">{formatDateTime(p.paid_at)}</Td>
                    <Td className="text-right">
                      <span className={`font-medium tabular-nums ${fully ? "text-subtle-foreground line-through" : ""}`}>{formatMoney(p.amount)}</span>
                      {refunded && (
                        <span className="mt-0.5 flex justify-end">
                          <Badge variant="warning">{fully ? "Annulé" : `− ${formatMoney(p.refunded_amount)}`}</Badge>
                        </span>
                      )}
                    </Td>
                    <Td className="text-right">{ctx.can("payments.refund") && <RefundDialog payment={p} />}</Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
          <Pagination page={page} total={count ?? 0} searchParams={{ ...sp, from: fromDate, to: toDate }} />
        </>
      )}
    </div>
  );
}
