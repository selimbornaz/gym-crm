import type { Metadata } from "next";
import Link from "next/link";
import { CreditCard } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Pagination, pageRange } from "@/components/app/pagination";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { requirePagePermission } from "@/lib/auth/context";
import { addDaysIso, formatDateTime, formatMoney, sumAmounts, todayInTunis, tunisLocalToIso } from "@/lib/format";
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
    <div className="flex flex-col gap-6">
      <PageHeader title="Paiements" description="Journal des encaissements. Un paiement n'est jamais supprimé : il se rembourse ou s'annule." />

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          <Label htmlFor="from">Du</Label>
          <Input id="from" name="from" type="date" defaultValue={fromDate} className="bg-card" />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="to">Au</Label>
          <Input id="to" name="to" type="date" defaultValue={toDate} className="bg-card" />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="method">Moyen</Label>
          <NativeSelect id="method" name="method" defaultValue={sp.method ?? ""} className="bg-card">
            <option value="">Tous</option>
            {((methods ?? []) as PaymentMethodRow[]).map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" variant="secondary">Filtrer</Button>
      </form>

      {totals && (
        <dl className="grid grid-cols-2 divide-x rounded-xl border bg-card sm:grid-cols-4">
          <Stat label="Encaissé (brut)" value={formatMoney(summary.gross)} />
          <Stat label="Remboursé" value={formatMoney(summary.refunds)} />
          <Stat label="Net" value={formatMoney(summary.net)} />
          <Stat label="Nombre de paiements" value={String(summary.n)} />
        </dl>
      )}

      {rows.length === 0 ? (
        <EmptyState icon={CreditCard} title="Aucun paiement sur la période" description="Les paiements s'enregistrent depuis la fiche d'un membre." />
      ) : (
        <>
          <Table>
            <THead>
              <tr><Th>Reçu</Th><Th>Date</Th><Th>Membre</Th><Th>Affectation</Th><Th>Moyen</Th><Th className="text-right">Montant</Th><Th className="text-right">Remboursé</Th><Th /></tr>
            </THead>
            <TBody>
              {rows.map((p) => (
                <Tr key={p.id}>
                  <Td><Link href={`/payments/${p.id}/receipt`} className="font-mono text-xs hover:underline">{p.receipt_number}</Link></Td>
                  <Td className="whitespace-nowrap">{formatDateTime(p.paid_at)}</Td>
                  <Td><Link href={`/members/${p.member_id}`} className="hover:underline">{p.member_name}</Link></Td>
                  <Td>{p.plan_name ?? "Hors abonnement"}</Td>
                  <Td>{p.method_name}{p.reference && <span className="block text-xs text-muted-foreground">{p.reference}</span>}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(p.amount)}</Td>
                  <Td className="text-right tabular-nums">{Number(p.refunded_amount) > 0 ? formatMoney(p.refunded_amount) : "—"}</Td>
                  <Td className="text-right">{ctx.can("payments.refund") && <RefundDialog payment={p} />}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          <Pagination page={page} total={count ?? 0} searchParams={{ ...sp, from: fromDate, to: toDate }} />
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
