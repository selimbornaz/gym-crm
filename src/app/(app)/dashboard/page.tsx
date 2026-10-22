import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  Banknote,
  CalendarClock,
  CalendarDays,
  CircleDollarSign,
  TrendingUp,
  UserCheck,
  UserPlus,
  Users,
  UserX,
} from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePagePermission } from "@/lib/auth/context";
import { formatDateLong, formatDateTime, formatMoney, formatTime } from "@/lib/format";
import { ActiveMembersChart, NewMembersChart, RevenueChart } from "./charts";

export const metadata: Metadata = { title: "Tableau de bord" };

interface Stats {
  today: string;
  members_total: number;
  members_active: number;
  members_expired: number;
  members_expiring: number;
  members_suspended: number;
  new_members_month: number;
  checkins_today: number;
  present_now: number;
  growth: Array<{ month: string; new_members: number; active_members: number }>;
  recent_checkins: Array<{ id: string; member_id: string; name: string; code: string; at: string; overridden: boolean }>;
  // Présents uniquement avec la permission `dashboard.financial`
  revenue_today?: number;
  revenue_month?: number;
  revenue_year?: number;
  unpaid_total?: number;
  unpaid_count?: number;
  revenue_trend?: Array<{ month: string; net: number }>;
  recent_payments?: Array<{ id: string; member_id: string; name: string; amount: number; refunded: number; receipt: string; at: string }>;
}

export default async function DashboardPage() {
  const ctx = await requirePagePermission("dashboard.view");

  // Recalcul idempotent des alertes (expirations, impayés...) à l'ouverture.
  await ctx.supabase.rpc("refresh_notifications", { p_org: ctx.org.id });

  const [{ data, error }, { data: sessions }] = await Promise.all([
    ctx.supabase.rpc("dashboard_stats", { p_org: ctx.org.id }),
    ctx.can("schedule.read")
      ? ctx.supabase
          .from("sessions")
          .select("id, title, kind, starts_at, capacity, coach:coaches(full_name), bookings(status)")
          .eq("organization_id", ctx.org.id)
          .eq("status", "scheduled")
          .gte("starts_at", new Date().toISOString())
          .lte("starts_at", new Date(Date.now() + 7 * 86_400_000).toISOString())
          .order("starts_at")
          .limit(6)
      : Promise.resolve({ data: null }),
  ]);
  if (error || !data) {
    return <p className="text-sm text-danger">Impossible de charger le tableau de bord. Réessayez dans un instant.</p>;
  }
  const s = data as Stats;
  const financial = s.revenue_today !== undefined;
  const upcoming = (sessions ?? []) as unknown as Array<{ id: string; title: string; starts_at: string; capacity: number; coach: { full_name: string } | null; bookings: Array<{ status: string }> }>;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={`Bonjour ${ctx.fullName.split(" ")[0] ?? ""}`} description={`${formatDateLong(s.today)} · ${ctx.org.name}`} />

      {financial && (
        <section aria-label="Chiffres financiers" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Encaissé aujourd'hui" value={formatMoney(s.revenue_today)} icon={Banknote} href="/payments" />
          <StatCard label="Encaissé ce mois" value={formatMoney(s.revenue_month)} icon={CircleDollarSign} href="/reports" />
          <StatCard label="Encaissé cette année" value={formatMoney(s.revenue_year)} icon={TrendingUp} href="/reports" />
          <StatCard
            label="Soldes impayés"
            value={formatMoney(s.unpaid_total)}
            icon={AlertTriangle}
            tone={(s.unpaid_count ?? 0) > 0 ? "danger" : undefined}
            hint={`${s.unpaid_count} abonnement${(s.unpaid_count ?? 0) > 1 ? "s" : ""}`}
            href="/subscriptions?view=unpaid"
          />
        </section>
      )}

      <section aria-label="Membres" className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Membres inscrits" value={String(s.members_total)} icon={Users} href="/members" />
        <StatCard label="Abonnements actifs" value={String(s.members_active)} icon={UserCheck} href="/members?status=active" />
        <StatCard label="Expirent sous 7 jours" value={String(s.members_expiring)} icon={CalendarClock} tone={s.members_expiring > 0 ? "warning" : undefined} href="/subscriptions?view=expiring" />
        <StatCard label="Expirés" value={String(s.members_expired)} icon={UserX} href="/members?status=expired" />
        <StatCard label="Check-ins aujourd'hui" value={String(s.checkins_today)} icon={Activity} hint={`${s.present_now} encore présent${s.present_now > 1 ? "s" : ""}`} href="/attendance" />
        <StatCard label="Inscriptions ce mois" value={String(s.new_members_month)} icon={UserPlus} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Membres actifs</CardTitle>
            <CardDescription>En fin de mois, sur 12 mois</CardDescription>
          </CardHeader>
          <CardContent><ActiveMembersChart data={s.growth} /></CardContent>
        </Card>
        {financial ? (
          <Card>
            <CardHeader>
              <CardTitle>Encaissements nets</CardTitle>
              <CardDescription>Paiements reçus moins remboursements, par mois</CardDescription>
            </CardHeader>
            <CardContent><RevenueChart data={s.revenue_trend ?? []} /></CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Nouvelles inscriptions</CardTitle>
              <CardDescription>Par mois, sur 12 mois</CardDescription>
            </CardHeader>
            <CardContent><NewMembersChart data={s.growth} /></CardContent>
          </Card>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        {financial && (
          <ListCard title="Derniers paiements" href="/payments" empty="Aucun paiement.">
            {(s.recent_payments ?? []).map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <Link href={`/members/${p.member_id}`} className="block truncate font-medium hover:underline">{p.name}</Link>
                  <span className="text-xs text-muted-foreground">{formatDateTime(p.at)} · {p.receipt}</span>
                </span>
                <span className="shrink-0 tabular-nums">{formatMoney(p.amount)}</span>
              </li>
            ))}
          </ListCard>
        )}
        <ListCard title="Derniers passages" href="/attendance" empty="Aucun passage récent.">
          {s.recent_checkins.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 py-2">
              <Link href={`/members/${c.member_id}`} className="truncate font-medium hover:underline">{c.name}</Link>
              <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(c.at)}{c.overridden && " · dérogation"}</span>
            </li>
          ))}
        </ListCard>
        {upcoming && ctx.can("schedule.read") && (
          <ListCard title="Séances à venir (7 jours)" href="/schedule" empty="Aucune séance programmée.">
            {upcoming.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{u.title}</span>
                  <span className="text-xs text-muted-foreground">{formatDateTime(u.starts_at)}{u.coach && ` · ${u.coach.full_name}`}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                  <CalendarDays className="size-3" aria-hidden /> {u.bookings.filter((b) => b.status === "booked").length}/{u.capacity}
                </span>
              </li>
            ))}
          </ListCard>
        )}
      </section>
      <p className="text-xs text-muted-foreground">Toutes les heures sont affichées à l&apos;heure de Tunis. Mise à jour : {formatTime(new Date())}.</p>
    </div>
  );
}

function ListCard({ title, href, empty, children }: { title: string; href: string; empty: string; children: React.ReactNode[] }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{title}</CardTitle>
        <Link href={href} className="text-sm text-muted-foreground hover:text-foreground">Tout voir</Link>
      </CardHeader>
      <CardContent>
        {children.length === 0 ? <p className="py-4 text-sm text-muted-foreground">{empty}</p> : <ul className="divide-y text-sm">{children}</ul>}
      </CardContent>
    </Card>
  );
}
