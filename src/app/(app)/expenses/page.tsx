import type { Metadata } from "next";
import { Wallet } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Pagination, pageRange } from "@/components/app/pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { requirePagePermission } from "@/lib/auth/context";
import { addDaysIso, formatDate, formatMoney, todayInTunis } from "@/lib/format";
import { t } from "@/i18n";
import { ExpenseDialog, VoidExpenseDialog, type ExpenseValues } from "./expense-dialogs";

export const metadata: Metadata = { title: "Dépenses" };

const isDate = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; category?: string; page?: string }> }) {
  const sp = await searchParams;
  const ctx = await requirePagePermission("expenses.manage");
  const today = todayInTunis();
  const from = isDate(sp.from) ? sp.from! : addDaysIso(today, -90);
  const to = isDate(sp.to) ? sp.to! : today;
  const { page, from: rf, to: rt } = pageRange(sp.page);

  let query = ctx.supabase
    .from("expenses")
    .select("id, category, amount, spent_on, description, supplier, payment_method_id, voided_at, void_reason", { count: "exact" })
    .eq("organization_id", ctx.org.id)
    .gte("spent_on", from)
    .lte("spent_on", to);
  if (sp.category && sp.category in t.expenseCategory) query = query.eq("category", sp.category);

  const [{ data, count }, { data: methods }] = await Promise.all([
    query.order("spent_on", { ascending: false }).order("created_at", { ascending: false }).range(rf, rt),
    ctx.supabase.from("payment_methods").select("id, name").eq("organization_id", ctx.org.id).eq("is_active", true),
  ]);
  const rows = (data ?? []) as Array<ExpenseValues & { voided_at: string | null; void_reason: string | null }>;
  const methodOptions = (methods ?? []).map((m) => ({ id: m.id as string, label: m.name as string }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Dépenses" description="Loyer, électricité, salaires, équipement… Une dépense erronée s'annule, elle ne se supprime pas." actions={<ExpenseDialog methods={methodOptions} />} />

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1"><Label htmlFor="from">Du</Label><Input id="from" name="from" type="date" defaultValue={from} className="bg-card" /></div>
        <div className="grid gap-1"><Label htmlFor="to">Au</Label><Input id="to" name="to" type="date" defaultValue={to} className="bg-card" /></div>
        <div className="grid gap-1">
          <Label htmlFor="category">Catégorie</Label>
          <NativeSelect id="category" name="category" defaultValue={sp.category ?? ""} className="bg-card">
            <option value="">Toutes</option>
            {Object.entries(t.expenseCategory).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </NativeSelect>
        </div>
        <Button type="submit" variant="secondary">Filtrer</Button>
      </form>

      {rows.length === 0 ? (
        <EmptyState icon={Wallet} title="Aucune dépense sur la période" />
      ) : (
        <>
          <Table>
            <THead><tr><Th>Date</Th><Th>Catégorie</Th><Th>Description</Th><Th>Fournisseur</Th><Th className="text-right">Montant</Th><Th /></tr></THead>
            <TBody>
              {rows.map((e) => (
                <Tr key={e.id} className={e.voided_at ? "opacity-50" : undefined}>
                  <Td className="whitespace-nowrap">{formatDate(e.spent_on)}</Td>
                  <Td><Badge variant="outline">{t.expenseCategory[e.category]}</Badge></Td>
                  <Td>
                    {e.description}
                    {e.voided_at && <span className="block text-xs text-danger">Annulée : {e.void_reason}</span>}
                  </Td>
                  <Td>{e.supplier ?? "—"}</Td>
                  <Td className={`text-right tabular-nums ${e.voided_at ? "line-through" : ""}`}>{formatMoney(e.amount)}</Td>
                  <Td className="text-right">
                    {!e.voided_at && (
                      <div className="flex justify-end gap-1">
                        <ExpenseDialog methods={methodOptions} expense={e} />
                        <VoidExpenseDialog expenseId={e.id} />
                      </div>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          <Pagination page={page} total={count ?? 0} searchParams={{ ...sp, from, to }} />
        </>
      )}
    </div>
  );
}
