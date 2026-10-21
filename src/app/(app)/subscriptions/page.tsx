import type { Metadata } from "next";
import Link from "next/link";
import { ReceiptText } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Pagination, pageRange } from "@/components/app/pagination";
import { SearchBar } from "@/components/app/search-bar";
import { PaymentBadge, SubscriptionBadge } from "@/components/app/status-badge";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { requirePagePermission } from "@/lib/auth/context";
import { addDaysIso, formatDate, formatMoney, todayInTunis } from "@/lib/format";
import { sanitizeSearch } from "@/lib/validation";
import type { SubscriptionRow } from "@/lib/types";

export const metadata: Metadata = { title: "Abonnements" };

const VIEWS = {
  current: "En cours",
  expiring: "Expirent sous 7 jours",
  expired: "Expirés (30 derniers jours)",
  unpaid: "Avec reste à payer",
  scheduled: "À venir",
  all: "Tous",
} as const;
type View = keyof typeof VIEWS;

export default async function SubscriptionsPage({ searchParams }: { searchParams: Promise<{ q?: string; view?: string; page?: string }> }) {
  const sp = await searchParams;
  const ctx = await requirePagePermission("subscriptions.read");
  const { page, from, to } = pageRange(sp.page);
  const view: View = sp.view && sp.view in VIEWS ? (sp.view as View) : "current";
  const q = sanitizeSearch(sp.q);
  const today = todayInTunis();

  let query = ctx.supabase.from("subscription_overview").select("*", { count: "exact" }).eq("organization_id", ctx.org.id);
  if (q) query = query.or(`member_name.ilike.*${q}*,member_code.ilike.*${q}*,plan_name.ilike.*${q}*`);
  switch (view) {
    case "current":
      query = query.eq("effective_status", "active").order("end_date");
      break;
    case "expiring":
      query = query.neq("status", "cancelled").gte("end_date", today).lte("end_date", addDaysIso(today, 7)).order("end_date");
      break;
    case "expired":
      query = query.eq("effective_status", "expired").gte("end_date", addDaysIso(today, -30)).order("end_date", { ascending: false });
      break;
    case "unpaid":
      query = query.neq("status", "cancelled").gt("balance", 0).order("start_date");
      break;
    case "scheduled":
      query = query.eq("effective_status", "scheduled").order("start_date");
      break;
    default:
      query = query.order("created_at", { ascending: false });
  }

  const { data, count } = await query.range(from, to);
  const rows = (data ?? []) as SubscriptionRow[];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Abonnements" description="Suivi des échéances, renouvellements et soldes. Les abonnements expirés sont conservés." />
      <SearchBar placeholder="Membre, n° ou formule" defaultValue={sp.q} resetHref="/subscriptions">
        <NativeSelect name="view" defaultValue={view} aria-label="Vue" className="w-auto bg-card">
          {Object.entries(VIEWS).map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </NativeSelect>
      </SearchBar>

      {rows.length === 0 ? (
        <EmptyState icon={ReceiptText} title="Aucun abonnement dans cette vue" description="Les abonnements se créent depuis la fiche d'un membre." />
      ) : (
        <>
          <Table>
            <THead>
              <tr><Th>Membre</Th><Th>Formule</Th><Th>Période</Th><Th>Statut</Th><Th className="text-right">Montant</Th><Th className="text-right">Reste</Th><Th>Règlement</Th></tr>
            </THead>
            <TBody>
              {rows.map((s) => (
                <Tr key={s.id}>
                  <Td>
                    <Link href={`/members/${s.member_id}`} className="font-medium hover:underline">{s.member_name}</Link>
                    <p className="text-xs text-muted-foreground">{s.member_code} · {s.member_phone ?? ""}</p>
                  </Td>
                  <Td>{s.plan_name}</Td>
                  <Td className="whitespace-nowrap">{formatDate(s.start_date)} → {formatDate(s.end_date)}</Td>
                  <Td><SubscriptionBadge status={s.effective_status} /></Td>
                  <Td className="text-right tabular-nums">{formatMoney(s.total_due)}</Td>
                  <Td className={`text-right tabular-nums ${Number(s.balance) > 0 && s.status !== "cancelled" ? "font-medium text-danger" : ""}`}>
                    {s.status === "cancelled" ? "—" : formatMoney(s.balance)}
                  </Td>
                  <Td>{s.status === "cancelled" ? "—" : <PaymentBadge status={s.payment_status} />}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          <Pagination page={page} total={count ?? 0} searchParams={sp} />
        </>
      )}
    </div>
  );
}
