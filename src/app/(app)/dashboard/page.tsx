import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  CircleDollarSign,
  Clock3,
  Receipt,
  TrendingUp,
  UserCheck,
  UserPlus,
  Users,
  UserX,
} from "lucide-react";
import { AvatarStack, InitialsAvatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { requirePagePermission } from "@/lib/auth/context";
import { addDaysIso, formatDateLong, formatMoney, formatTime, sumAmounts, todayInTunis, tunisLocalToIso } from "@/lib/format";
import { BentoCard, Figure, TrendPill } from "./bento";
import { HeroArea, MonthlyBars, Sparkline, type Point } from "./bento-charts";

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
  // Uniquement avec la permission `dashboard.financial`
  revenue_today?: number;
  revenue_month?: number;
  revenue_year?: number;
  unpaid_total?: number;
  unpaid_count?: number;
  revenue_trend?: Array<{ month: string; net: number }>;
  recent_payments?: Array<{ id: string; member_id: string; name: string; amount: number; refunded: number; receipt: string; at: string }>;
}

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const monthShort = (key: string) => MONTHS[Number(key.slice(5, 7)) - 1] ?? key;
const dayLabel = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Premier jour du mois précédent, au format ISO. */
function previousMonthStart(today: string): string {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 10);
}

/** Variation relative ; null si la base est nulle (pas de pourcentage trompeur). */
const ratio = (current: number, previous: number) => (previous > 0 ? (current - previous) / previous : null);

export default async function DashboardPage() {
  const ctx = await requirePagePermission("dashboard.view");
  const db = ctx.supabase;
  const org = ctx.org.id;

  // Recalcul idempotent des alertes (expirations, impayés…) à l'ouverture.
  await db.rpc("refresh_notifications", { p_org: org });

  const today = todayInTunis();
  const monthStart = `${today.slice(0, 8)}01`;
  const prevStart = previousMonthStart(today);
  const dayOfMonth = Number(today.slice(8, 10));
  const sameDayPrevMonth = `${prevStart.slice(0, 8)}${String(dayOfMonth).padStart(2, "0")}`;
  const financialAllowed = ctx.can("dashboard.financial");

  const [statsRes, dailyRevenue, checkinRows, signups, sessions] = await Promise.all([
    db.rpc("dashboard_stats", { p_org: org }),
    financialAllowed
      ? db.rpc("revenue_report", { p_org: org, p_from: prevStart, p_to: today, p_granularity: "day" })
      : Promise.resolve({ data: null }),
    db
      .from("attendance")
      .select("checked_in_at")
      .eq("organization_id", org)
      .eq("status", "valid")
      .gte("checked_in_at", tunisLocalToIso(`${addDaysIso(today, -13)}T00:00`))
      .limit(5000),
    db.from("members").select("registered_on").eq("organization_id", org).gte("registered_on", prevStart).limit(5000),
    ctx.can("schedule.read")
      ? db
          .from("sessions")
          .select("id, title, kind, starts_at, capacity, coach:coaches(full_name), bookings(status)")
          .eq("organization_id", org)
          .eq("status", "scheduled")
          .gte("starts_at", new Date().toISOString())
          .order("starts_at")
          .limit(5)
      : Promise.resolve({ data: null }),
  ]);

  if (statsRes.error || !statsRes.data) {
    return <p className="text-sm text-danger">Impossible de charger le tableau de bord. Réessayez dans un instant.</p>;
  }
  const s = statsRes.data as Stats;
  const financial = s.revenue_today !== undefined;

  // --- Encaissements quotidiens (30 j) et comparaison à période égale ---------
  const revenueByDay = new Map(
    ((dailyRevenue.data ?? []) as Array<{ period: string; net: number }>).map((r) => [r.period, Number(r.net)]),
  );
  const revenue30: Point[] = Array.from({ length: 30 }, (_, i) => {
    const d = addDaysIso(today, i - 29);
    return { label: dayLabel(d), value: revenueByDay.get(d) ?? 0 };
  });
  const sumBetween = (from: string, to: string) =>
    Number(sumAmounts([...revenueByDay].filter(([d]) => d >= from && d <= to).map(([, v]) => v)));
  const revenueMtd = sumBetween(monthStart, today);
  const revenuePrevSame = sumBetween(prevStart, sameDayPrevMonth);

  // --- Passages quotidiens (14 j) ---------------------------------------------
  const checkinsByDay = new Map<string, number>();
  for (const r of (checkinRows.data ?? []) as Array<{ checked_in_at: string }>) {
    const d = todayInTunis(new Date(r.checked_in_at));
    checkinsByDay.set(d, (checkinsByDay.get(d) ?? 0) + 1);
  }
  const checkins14: Point[] = Array.from({ length: 14 }, (_, i) => {
    const d = addDaysIso(today, i - 13);
    return { label: dayLabel(d), value: checkinsByDay.get(d) ?? 0 };
  });
  const avg7 = checkins14.slice(6, 13).reduce((n, p) => n + p.value, 0) / 7;

  // --- Inscriptions : mois en cours vs même période du mois précédent --------
  const regDates = ((signups.data ?? []) as Array<{ registered_on: string }>).map((r) => r.registered_on);
  const signupsMtd = regDates.filter((d) => d >= monthStart).length;
  const signupsPrevSame = regDates.filter((d) => d >= prevStart && d <= sameDayPrevMonth).length;

  // --- Membres actifs (fin de mois, 12 mois) ----------------------------------
  const activeSeries: Point[] = s.growth.map((g) => ({ label: `${monthShort(g.month)} ${g.month.slice(0, 4)}`, value: g.active_members }));
  const activeNow = s.growth.at(-1)?.active_members ?? s.members_active;
  const activePrev = s.growth.at(-2)?.active_members ?? 0;

  const monthly: Point[] = financial
    ? (s.revenue_trend ?? []).map((r) => ({ label: monthShort(r.month), value: Number(r.net) }))
    : s.growth.map((g) => ({ label: monthShort(g.month), value: g.new_members }));

  const upcoming = (sessions.data ?? []) as unknown as Array<{
    id: string;
    title: string;
    kind: string;
    starts_at: string;
    capacity: number;
    coach: { full_name: string } | null;
    bookings: Array<{ status: string }>;
  }>;
  const presentNames = s.recent_checkins.map((c) => c.name);

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-eyebrow">{formatDateLong(s.today)}</p>
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.03em]">
          Bonjour {ctx.fullName.split(" ")[0] ?? ""}
          <span className="text-muted-foreground"> — voici {ctx.org.name} aujourd&apos;hui.</span>
        </h1>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-6 lg:grid-cols-12">
        {/* Héros ------------------------------------------------------------- */}
        {financial ? (
          <BentoCard title="Encaissé ce mois" icon={CircleDollarSign} href="/reports" linkLabel="Rapports" className="md:col-span-6 lg:col-span-8 lg:row-span-2">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex flex-col gap-2">
                <Figure value={formatMoney(revenueMtd)} size="xl" />
                <TrendPill ratio={ratio(revenueMtd, revenuePrevSame)} caption={`vs 1–${dayOfMonth} du mois dernier`} />
              </div>
              <dl className="flex gap-6 text-right">
                <div>
                  <dt className="text-eyebrow">Aujourd&apos;hui</dt>
                  <dd className="text-figure mt-1.5 text-[15px]">{formatMoney(s.revenue_today)}</dd>
                </div>
                <div>
                  <dt className="text-eyebrow">Cette année</dt>
                  <dd className="text-figure mt-1.5 text-[15px]">{formatMoney(s.revenue_year)}</dd>
                </div>
              </dl>
            </div>
            <div className="mt-5 flex-1">
              <HeroArea data={revenue30} kind="money" label="Encaissements nets par jour sur 30 jours" />
            </div>
            <p className="mt-2 text-[11px] text-subtle-foreground">Encaissements nets par jour, 30 derniers jours · paiements reçus moins remboursements</p>
          </BentoCard>
        ) : (
          <BentoCard title="Membres actifs" icon={UserCheck} href="/members?status=active" className="md:col-span-6 lg:col-span-8 lg:row-span-2">
            <div className="flex flex-col gap-2">
              <Figure value={activeNow.toLocaleString("fr-FR")} size="xl" />
              <TrendPill ratio={ratio(activeNow, activePrev)} caption="vs fin du mois dernier" />
            </div>
            <div className="mt-5 flex-1">
              <HeroArea data={activeSeries} kind="count" label="Membres actifs en fin de mois sur 12 mois" />
            </div>
          </BentoCard>
        )}

        {/* Colonne droite : deux KPI empilés ---------------------------------- */}
        {financial ? (
          <BentoCard title="Membres actifs" icon={UserCheck} href="/members?status=active" className="md:col-span-3 lg:col-span-4">
            <div className="flex items-end justify-between gap-3">
              <div className="flex flex-col gap-2">
                <Figure value={activeNow.toLocaleString("fr-FR")} />
                <TrendPill ratio={ratio(activeNow, activePrev)} caption="vs mois dernier" />
              </div>
            </div>
            <div className="mt-3">
              <Sparkline data={activeSeries} kind="count" label="Membres actifs sur 12 mois" />
            </div>
          </BentoCard>
        ) : (
          <BentoCard title="Inscriptions ce mois" icon={UserPlus} href="/members" className="md:col-span-3 lg:col-span-4">
            <Figure value={String(signupsMtd)} />
            <div className="mt-2">
              <TrendPill ratio={ratio(signupsMtd, signupsPrevSame)} caption="vs même période" />
            </div>
          </BentoCard>
        )}

        <BentoCard title="Passages aujourd'hui" icon={Activity} href="/attendance" linkLabel="Accueil" className="md:col-span-3 lg:col-span-4">
          <div className="flex items-end justify-between gap-3">
            <div className="flex flex-col gap-2">
              <Figure value={String(s.checkins_today)} />
              <span className="flex items-center gap-1.5 text-[11px] text-subtle-foreground">
                <span className="relative flex size-1.5">
                  {s.present_now > 0 && <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500/60" />}
                  <span className={`relative inline-flex size-1.5 rounded-full ${s.present_now > 0 ? "bg-emerald-500" : "bg-zinc-400"}`} />
                </span>
                {s.present_now} sur place · moyenne 7 j : {avg7.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}
              </span>
            </div>
          </div>
          <div className="mt-3">
            <Sparkline data={checkins14} kind="count" color="var(--chart-3)" label="Passages par jour sur 14 jours" />
          </div>
        </BentoCard>

        {/* Rangée de tuiles compactes ----------------------------------------- */}
        <BentoCard title="Membres inscrits" icon={Users} href="/members" className="md:col-span-3 lg:col-span-3">
          <Figure value={s.members_total.toLocaleString("fr-FR")} size="md" />
          <p className="mt-2 text-[11px] text-subtle-foreground">
            {signupsMtd} nouveau{signupsMtd > 1 ? "x" : ""} ce mois
            {ratio(signupsMtd, signupsPrevSame) !== null && (
              <span className="ml-1.5 inline-block align-middle">
                <TrendPill ratio={ratio(signupsMtd, signupsPrevSame)} />
              </span>
            )}
          </p>
        </BentoCard>

        <BentoCard title="Expirent sous 7 j" icon={CalendarClock} href="/subscriptions?view=expiring" linkLabel="Relancer" className="md:col-span-3 lg:col-span-3">
          <Figure value={String(s.members_expiring)} size="md" />
          <div className="mt-2">
            {s.members_expiring > 0 ? <Badge variant="warning" dot>À renouveler</Badge> : <Badge variant="success" dot>Rien à signaler</Badge>}
          </div>
        </BentoCard>

        <BentoCard title="Expirés" icon={UserX} href="/members?status=expired" className="md:col-span-3 lg:col-span-3">
          <Figure value={String(s.members_expired)} size="md" />
          <div className="mt-2">
            {s.members_expired > 0 ? <Badge variant="danger" dot>Accès bloqué à l&apos;entrée</Badge> : <Badge variant="success" dot>Tous à jour</Badge>}
          </div>
        </BentoCard>

        {financial ? (
          <BentoCard title="Soldes impayés" icon={AlertTriangle} href="/subscriptions?view=unpaid" className="md:col-span-3 lg:col-span-3">
            <Figure value={formatMoney(s.unpaid_total)} size="md" />
            <div className="mt-2">
              {(s.unpaid_count ?? 0) > 0 ? (
                <Badge variant="danger" dot>{s.unpaid_count} abonnement{(s.unpaid_count ?? 0) > 1 ? "s" : ""}</Badge>
              ) : (
                <Badge variant="success" dot>Aucun impayé</Badge>
              )}
            </div>
          </BentoCard>
        ) : (
          <BentoCard title="Suspendus" icon={Clock3} className="md:col-span-3 lg:col-span-3">
            <Figure value={String(s.members_suspended)} size="md" />
          </BentoCard>
        )}

        {/* Tendance mensuelle + séances à venir ------------------------------- */}
        <BentoCard
          title={financial ? "Encaissements nets · 12 mois" : "Nouvelles inscriptions · 12 mois"}
          icon={TrendingUp}
          href={financial ? "/reports?g=month" : undefined}
          className="md:col-span-6 lg:col-span-7"
        >
          <MonthlyBars data={monthly} kind={financial ? "money" : "count"} label={financial ? "Encaissements nets par mois" : "Inscriptions par mois"} />
        </BentoCard>

        <BentoCard title="Prochaines séances" icon={CalendarDays} href="/schedule" linkLabel="Planning" className="md:col-span-6 lg:col-span-5">
          {upcoming.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-muted-foreground">Aucune séance programmée.</p>
          ) : (
            <ul className="-mx-2 flex flex-col">
              {upcoming.map((u) => {
                const booked = u.bookings.filter((b) => b.status === "booked").length;
                const fill = Math.min(1, booked / u.capacity);
                return (
                  <li key={u.id} className="rounded-lg px-2 py-2 transition-colors duration-300 ease-out hover:bg-accent/50">
                    <div className="flex items-center gap-3">
                      <div className="w-12 shrink-0 text-right">
                        <p className="text-[13px] font-semibold tabular-nums">{formatTime(u.starts_at)}</p>
                        <p className="text-[10px] uppercase tracking-[0.06em] text-subtle-foreground">
                          {new Intl.DateTimeFormat("fr-FR", { weekday: "short", timeZone: "Africa/Tunis" }).format(new Date(u.starts_at))}
                        </p>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium">{u.title}</p>
                        <p className="truncate text-[11px] text-muted-foreground">{u.coach?.full_name ?? "Sans coach"}</p>
                      </div>
                      <div className="w-20 shrink-0">
                        <p className="text-right text-[11px] tabular-nums text-muted-foreground">
                          {booked}/{u.capacity}
                        </p>
                        <div className="mt-1 h-1 overflow-hidden rounded-full bg-secondary">
                          <div className={`h-full rounded-full ${fill >= 1 ? "bg-red-500" : "bg-chart-1"}`} style={{ width: `${Math.max(fill * 100, 4)}%` }} />
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </BentoCard>

        {/* Activité récente ---------------------------------------------------- */}
        {financial && (
          <BentoCard title="Derniers paiements" icon={Receipt} href="/payments" className="md:col-span-6 lg:col-span-7">
            <ul className="-mx-2 flex flex-col">
              {(s.recent_payments ?? []).slice(0, 6).map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/payments/${p.id}/receipt`}
                    className="flex items-center gap-3 rounded-lg px-2 py-2 transition-all duration-300 ease-out hover:bg-accent/50"
                  >
                    <InitialsAvatar name={p.name} className="size-7 text-[10px]" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">{p.name}</p>
                      <p className="truncate font-mono text-[11px] text-subtle-foreground">{p.receipt}</p>
                    </div>
                    {Number(p.refunded) > 0 && <Badge variant="warning">Remboursé {formatMoney(p.refunded)}</Badge>}
                    <span className="text-figure w-28 shrink-0 text-right text-[13px]">{formatMoney(p.amount)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </BentoCard>
        )}

        <BentoCard
          title="Derniers passages"
          icon={Activity}
          href="/attendance"
          className={financial ? "md:col-span-6 lg:col-span-5" : "md:col-span-6 lg:col-span-12"}
          action={<AvatarStack names={presentNames} max={4} label={`${presentNames.length} passages récents`} />}
        >
          {s.recent_checkins.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-muted-foreground">Aucun passage récent.</p>
          ) : (
            <ul className="-mx-2 flex flex-col">
              {s.recent_checkins.slice(0, 6).map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/members/${c.member_id}`}
                    className="flex items-center gap-3 rounded-lg px-2 py-2 transition-all duration-300 ease-out hover:bg-accent/50"
                  >
                    <InitialsAvatar name={c.name} className="size-7 text-[10px]" />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{c.name}</span>
                    {c.overridden && <Badge variant="warning">Dérogation</Badge>}
                    <span className="shrink-0 text-[11px] tabular-nums text-subtle-foreground">
                      {c.at.slice(0, 10) === new Date().toISOString().slice(0, 10) ? formatTime(c.at) : `${dayLabel(todayInTunis(new Date(c.at)))} ${formatTime(c.at)}`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </BentoCard>
      </div>
    </div>
  );
}
