import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { requirePagePermission } from "@/lib/auth/context";
import { formatDate, formatMoney, todayInTunis } from "@/lib/format";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";
import { PrintButton } from "@/components/app/print-button";

export const metadata: Metadata = { title: "Rapports" };

const GRANULARITIES = { day: "Par jour", week: "Par semaine", month: "Par mois", year: "Par année" } as const;
type Granularity = keyof typeof GRANULARITIES;

interface PL {
  gross: number;
  refunds: number;
  net_revenue: number;
  expenses: number;
  result: number;
  expenses_by_category: Array<{ category: keyof typeof t.expenseCategory; amount: number }>;
}

const isDate = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; g?: string }> }) {
  const sp = await searchParams;
  const ctx = await requirePagePermission("reports.financial");
  const today = todayInTunis();
  const from = isDate(sp.from) ? sp.from! : `${today.slice(0, 8)}01`;
  const to = isDate(sp.to) ? sp.to! : today;
  const g: Granularity = sp.g && sp.g in GRANULARITIES ? (sp.g as Granularity) : "day";

  const [revenue, byPlan, pl] = await Promise.all([
    ctx.supabase.rpc("revenue_report", { p_org: ctx.org.id, p_from: from, p_to: to, p_granularity: g }),
    ctx.supabase.rpc("revenue_by_plan", { p_org: ctx.org.id, p_from: from, p_to: to }),
    ctx.supabase.rpc("profit_and_loss", { p_org: ctx.org.id, p_from: from, p_to: to }),
  ]);
  const error = revenue.error ?? byPlan.error ?? pl.error;
  const periods = (revenue.data ?? []) as Array<{ period: string; gross: number; refunds: number; net: number; payments_count: number }>;
  const plans = (byPlan.data ?? []) as Array<{ plan_name: string; net: number; payments_count: number }>;
  const p = pl.data as PL | null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Rapports financiers"
        description={`Du ${formatDate(from)} au ${formatDate(to)} — encaissements réels uniquement (les impayés ne sont pas du chiffre d'affaires).`}
        actions={<div className="no-print"><PrintButton /></div>}
      />

      <form method="get" className="no-print flex flex-wrap items-end gap-3">
        <div className="grid gap-1"><Label htmlFor="from">Du</Label><Input id="from" name="from" type="date" defaultValue={from} className="bg-card" /></div>
        <div className="grid gap-1"><Label htmlFor="to">Au</Label><Input id="to" name="to" type="date" defaultValue={to} className="bg-card" /></div>
        <div className="grid gap-1">
          <Label htmlFor="g">Regroupement</Label>
          <NativeSelect id="g" name="g" defaultValue={g} className="bg-card">
            {Object.entries(GRANULARITIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </NativeSelect>
        </div>
        <Button type="submit" variant="secondary">Afficher</Button>
      </form>

      {error ? (
        <p className="text-sm text-danger">Période invalide ou rapport indisponible.</p>
      ) : (
        <>
          {p && (
            <section className="grid gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Compte de résultat simplifié</CardTitle>
                  <CardDescription>Base encaissements / décaissements</CardDescription>
                </CardHeader>
                <CardContent>
                  <dl className="grid gap-2 text-sm">
                    <Line label="Encaissements bruts" value={p.gross} />
                    <Line label="Remboursements" value={Number(p.refunds) > 0 ? -p.refunds : 0} />
                    <Line label="Encaissements nets" value={p.net_revenue} strong />
                    <Line label="Dépenses" value={Number(p.expenses) > 0 ? -p.expenses : 0} />
                    <div className="mt-2 border-t pt-2">
                      <Line label="Résultat" value={p.result} strong tone={p.result >= 0 ? "success" : "danger"} />
                    </div>
                  </dl>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Dépenses par catégorie</CardTitle></CardHeader>
                <CardContent>
                  {p.expenses_by_category.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Aucune dépense.</p>
                  ) : (
                    <ul className="grid gap-2 text-sm">
                      {p.expenses_by_category.map((c) => (
                        <li key={c.category} className="grid gap-1">
                          <span className="flex justify-between"><span>{t.expenseCategory[c.category]}</span><span className="tabular-nums">{formatMoney(c.amount)}</span></span>
                          <span className="h-1.5 rounded-full bg-muted">
                            <span className="block h-full rounded-full bg-chart-2" style={{ width: `${(c.amount / Math.max(p.expenses, 1)) * 100}%` }} />
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </section>
          )}

          <section className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <h2 className="mb-2 font-semibold">Encaissements {GRANULARITIES[g].toLowerCase()}</h2>
              <Table>
                <THead><tr><Th>Période</Th><Th className="text-right">Paiements</Th><Th className="text-right">Brut</Th><Th className="text-right">Remboursé</Th><Th className="text-right">Net</Th></tr></THead>
                <TBody>
                  {periods.length === 0 && <Tr><Td colSpan={5} className="text-center text-muted-foreground">Aucun encaissement sur la période.</Td></Tr>}
                  {periods.map((r) => (
                    <Tr key={r.period}>
                      <Td>{periodLabel(r.period, g)}</Td>
                      <Td className="text-right tabular-nums">{r.payments_count}</Td>
                      <Td className="text-right tabular-nums">{formatMoney(r.gross)}</Td>
                      <Td className="text-right tabular-nums">{Number(r.refunds) > 0 ? formatMoney(r.refunds) : "—"}</Td>
                      <Td className="text-right font-medium tabular-nums">{formatMoney(r.net)}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
            <div>
              <h2 className="mb-2 font-semibold">Par formule</h2>
              <Table>
                <THead><tr><Th>Formule</Th><Th className="text-right">Net</Th></tr></THead>
                <TBody>
                  {plans.length === 0 && <Tr><Td colSpan={2} className="text-center text-muted-foreground">—</Td></Tr>}
                  {plans.map((r) => (
                    <Tr key={r.plan_name}>
                      <Td>{r.plan_name}<span className="block text-xs text-muted-foreground">{r.payments_count} paiement{r.payments_count > 1 ? "s" : ""}</span></Td>
                      <Td className="text-right tabular-nums">{formatMoney(r.net)}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function periodLabel(iso: string, g: Granularity): string {
  if (g === "year") return iso.slice(0, 4);
  if (g === "month") return `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  if (g === "week") return `Semaine du ${formatDate(iso)}`;
  return formatDate(iso);
}

function Line({ label, value, strong, tone }: { label: string; value: number; strong?: boolean; tone?: "success" | "danger" }) {
  return (
    <div className={cn("flex justify-between", strong && "font-semibold")}>
      <dt>{label}</dt>
      <dd className={cn("tabular-nums", tone === "success" && "text-success", tone === "danger" && "text-danger")}>{formatMoney(value)}</dd>
    </div>
  );
}
