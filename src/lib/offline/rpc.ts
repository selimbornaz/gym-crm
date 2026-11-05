import "server-only";
import { NEEDS_INTERNET, type LocalResult } from "./errors";
import { getMeta, rowsOf, type Row } from "./store";
import { addDays, dateInZone, orgTimezone, orgToday, roundMoney } from "./views";
import { runLocalWriteRpc } from "./writes";

/**
 * Équivalents locaux des fonctions de lecture (migration 0004), sur les seules
 * lignes visibles par ce compte. Le test hors ligne les compare aux fonctions
 * PostgreSQL réelles. Les fonctions qui écrivent sont dans writes.ts.
 */
type Args = Record<string, unknown>;

const ok = (data: unknown): LocalResult => ({ data, error: null, count: null, status: 200, statusText: "OK" });

const permissionDenied: LocalResult = {
  data: null, error: { code: "42501", message: "Action non autorisée" }, count: null, status: 403, statusText: "",
};

function permissions(user: string, org: unknown): string[] {
  return JSON.parse(getMeta(user, `permissions:${org}`) ?? "[]") as string[];
}

const inOrg = (user: string, table: string, org: unknown) => rowsOf(user, table).filter((r) => r.organization_id === org);
const sumOf = (rows: Row[], column: string) => roundMoney(rows.reduce((n, r) => n + Number(r[column]), 0));

function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function addMonths(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** date_trunc de PostgreSQL : la semaine commence le lundi. */
function truncDate(date: string, granularity: string): string {
  if (granularity === "day") return date;
  if (granularity === "month") return monthStart(date);
  if (granularity === "year") return `${date.slice(0, 4)}-01-01`;
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((day + 6) % 7));
}

function netRevenueBetween(user: string, org: unknown, tz: string, from: string, to: string): number {
  const within = (at: unknown) => {
    const day = dateInZone(at as string, tz);
    return day >= from && day <= to;
  };
  return roundMoney(
    sumOf(inOrg(user, "payments", org).filter((p) => within(p.paid_at)), "amount")
    - sumOf(inOrg(user, "payment_adjustments", org).filter((a) => within(a.created_at)), "amount"),
  );
}

const descByDate = (column: string) => (a: Row, b: Row) => Date.parse(b[column] as string) - Date.parse(a[column] as string);

function dashboardStats(user: string, org: unknown): LocalResult {
  const perms = permissions(user, org);
  if (!perms.includes("dashboard.view")) return permissionDenied;
  const tz = orgTimezone(user, org);
  const today = orgToday(user, org);
  const members = inOrg(user, "members", org);
  const kept = members.filter((m) => !m.archived_at);
  const end = (m: Row) => m.membership_end_date as string | null;
  const attendanceValid = inOrg(user, "attendance", org).filter((a) => a.status === "valid");
  const attendanceToday = attendanceValid.filter((a) => dateInZone(a.checked_in_at as string, tz) === today);
  const subscriptions = inOrg(user, "subscriptions", org);
  const memberById = new Map(members.map((m) => [m.id, m]));
  const firstMonth = addMonths(monthStart(today), -11);
  const months = Array.from({ length: 12 }, (_, i) => addMonths(firstMonth, i));

  const result: Row = {
    today,
    members_total: kept.length,
    members_active: kept.filter((m) => !m.membership_suspended && end(m) !== null && end(m)! >= today).length,
    members_expired: kept.filter((m) => end(m) !== null && end(m)! < today).length,
    members_expiring: kept.filter((m) => !m.membership_suspended && end(m) !== null && end(m)! >= today && end(m)! <= addDays(today, 7)).length,
    members_suspended: kept.filter((m) => m.membership_suspended).length,
    new_members_month: members.filter((m) => (m.registered_on as string) >= monthStart(today)).length,
    checkins_today: attendanceToday.length,
    present_now: attendanceToday.filter((a) => !a.checked_out_at).length,
    growth: months.map((mo) => {
      const next = addMonths(mo, 1);
      const last = addDays(next, -1);
      const at = last < today ? last : today;
      return {
        month: mo.slice(0, 7),
        new_members: members.filter((m) => (m.registered_on as string) >= mo && (m.registered_on as string) < next).length,
        active_members: new Set(subscriptions
          .filter((s) => s.status !== "cancelled" && (s.kind === "membership" || s.kind === "pass")
            && (s.start_date as string) <= at && (s.end_date as string) >= at)
          .map((s) => s.member_id)).size,
      };
    }),
    recent_checkins: [...attendanceValid].filter((a) => memberById.has(a.member_id)).sort(descByDate("checked_in_at")).slice(0, 8).map((a) => {
      const m = memberById.get(a.member_id)!;
      return { id: a.id, member_id: m.id, name: `${m.first_name} ${m.last_name}`, code: m.member_code, at: a.checked_in_at, overridden: a.override_reason !== null && a.override_reason !== undefined };
    }),
  };

  if (perms.includes("dashboard.financial")) {
    const unpaid = subscriptions.filter((s) => s.status !== "cancelled" && Number(s.total_due) > Number(s.amount_paid));
    Object.assign(result, {
      revenue_today: netRevenueBetween(user, org, tz, today, today),
      revenue_month: netRevenueBetween(user, org, tz, monthStart(today), today),
      revenue_year: netRevenueBetween(user, org, tz, `${today.slice(0, 4)}-01-01`, today),
      unpaid_total: roundMoney(unpaid.reduce((n, s) => n + Number(s.total_due) - Number(s.amount_paid), 0)),
      unpaid_count: unpaid.length,
      revenue_trend: months.map((mo) => {
        const last = addDays(addMonths(mo, 1), -1);
        return { month: mo.slice(0, 7), net: netRevenueBetween(user, org, tz, mo, last < today ? last : today) };
      }),
      recent_payments: inOrg(user, "payments", org).filter((p) => memberById.has(p.member_id)).sort(descByDate("paid_at")).slice(0, 8).map((p) => {
        const m = memberById.get(p.member_id)!;
        return { id: p.id, member_id: m.id, name: `${m.first_name} ${m.last_name}`, amount: p.amount, refunded: p.refunded_amount, receipt: p.receipt_number, at: p.paid_at };
      }),
    });
  }
  return ok(result);
}

function revenueReport(user: string, a: Args): LocalResult {
  const org = a.p_org;
  if (!permissions(user, org).includes("reports.financial")) return permissionDenied;
  const granularity = (a.p_granularity as string | undefined) ?? "day";
  const from = a.p_from as string;
  const to = a.p_to as string;
  const tz = orgTimezone(user, org);
  const buckets = new Map<string, { gross: number; refunds: number; count: number }>();
  const bucket = (k: string) => {
    const b = buckets.get(k) ?? { gross: 0, refunds: 0, count: 0 };
    buckets.set(k, b);
    return b;
  };
  for (const p of inOrg(user, "payments", org)) {
    const day = dateInZone(p.paid_at as string, tz);
    if (day < from || day > to) continue;
    const b = bucket(truncDate(day, granularity));
    b.gross += Number(p.amount);
    b.count++;
  }
  for (const x of inOrg(user, "payment_adjustments", org)) {
    const day = dateInZone(x.created_at as string, tz);
    if (day < from || day > to) continue;
    bucket(truncDate(day, granularity)).refunds += Number(x.amount);
  }
  return ok([...buckets.entries()].sort(([x], [y]) => (x < y ? -1 : 1)).map(([period, b]) => ({
    period, gross: roundMoney(b.gross), refunds: roundMoney(b.refunds), net: roundMoney(b.gross - b.refunds), payments_count: b.count,
  })));
}

function revenueByPlan(user: string, a: Args): LocalResult {
  const org = a.p_org;
  if (!permissions(user, org).includes("reports.financial")) return permissionDenied;
  const tz = orgTimezone(user, org);
  const subscriptions = new Map(inOrg(user, "subscriptions", org).map((s) => [s.id, s]));
  const plans = new Map<string, { net: number; count: number }>();
  for (const p of inOrg(user, "payments", org)) {
    const day = dateInZone(p.paid_at as string, tz);
    if (day < (a.p_from as string) || day > (a.p_to as string)) continue;
    const name = (subscriptions.get(p.subscription_id)?.plan_name as string | undefined) ?? "Hors abonnement";
    const plan = plans.get(name) ?? { net: 0, count: 0 };
    plan.net += Number(p.amount) - Number(p.refunded_amount);
    plan.count++;
    plans.set(name, plan);
  }
  return ok([...plans.entries()].map(([plan_name, v]) => ({ plan_name, net: roundMoney(v.net), payments_count: v.count })).sort((x, y) => y.net - x.net));
}

function profitAndLoss(user: string, a: Args): LocalResult {
  const org = a.p_org;
  if (!permissions(user, org).includes("reports.financial")) return permissionDenied;
  const from = a.p_from as string;
  const to = a.p_to as string;
  const tz = orgTimezone(user, org);
  const within = (at: unknown) => {
    const day = dateInZone(at as string, tz);
    return day >= from && day <= to;
  };
  const gross = sumOf(inOrg(user, "payments", org).filter((p) => within(p.paid_at)), "amount");
  const refunds = sumOf(inOrg(user, "payment_adjustments", org).filter((x) => within(x.created_at)), "amount");
  const expenses = inOrg(user, "expenses", org).filter((e) => !e.voided_at && (e.spent_on as string) >= from && (e.spent_on as string) <= to);
  const total = sumOf(expenses, "amount");
  const byCategory = new Map<string, number>();
  for (const e of expenses) byCategory.set(e.category as string, (byCategory.get(e.category as string) ?? 0) + Number(e.amount));
  return ok({
    gross, refunds, net_revenue: roundMoney(gross - refunds), expenses: total, result: roundMoney(gross - refunds - total),
    expenses_by_category: [...byCategory.entries()].map(([category, amount]) => ({ category, amount: roundMoney(amount) })).sort((x, y) => y.amount - x.amount),
  });
}

function findMemberDuplicates(user: string, a: Args): LocalResult {
  const org = a.p_org;
  if (!permissions(user, org).includes("members.write")) return permissionDenied;
  const digits = String(a.p_phone ?? "").replace(/\D/g, "");
  const email = a.p_email ? String(a.p_email).trim().toLowerCase() : null;
  const first = String(a.p_first_name ?? "").trim().toLowerCase();
  const last = String(a.p_last_name ?? "").trim().toLowerCase();
  const samePhone = (m: Row) => digits.length > 0 && String(m.phone_digits ?? "").slice(-8) === digits.slice(-8) && m.phone_digits !== null;
  const sameEmail = (m: Row) => email !== null && String(m.email ?? "").toLowerCase() === email;
  const rows = inOrg(user, "members", org)
    .filter((m) => m.id !== a.p_exclude)
    .filter((m) =>
      (digits.length >= 8 && samePhone(m))
      || (email !== null && email.length > 3 && sameEmail(m))
      || (String(m.first_name).trim().toLowerCase() === first && String(m.last_name).trim().toLowerCase() === last))
    .slice(0, 5);
  return ok(rows.map((m) => ({
    id: m.id, member_code: m.member_code, full_name: `${m.first_name} ${m.last_name}`, phone: m.phone ?? null, email: m.email ?? null,
    match_reason: samePhone(m) ? "Même téléphone" : sameEmail(m) ? "Même email" : "Même nom",
  })));
}

export function runLocalRpc(user: string, name: string, args: Args): LocalResult {
  switch (name) {
    case "my_permissions": return ok(permissions(user, args.org));
    case "dashboard_stats": return dashboardStats(user, args.p_org);
    case "revenue_report": return revenueReport(user, args);
    case "revenue_by_plan": return revenueByPlan(user, args);
    case "profit_and_loss": return profitAndLoss(user, args);
    case "find_member_duplicates": return findMemberDuplicates(user, args);
    // Simple rafraîchissement des alertes, fait par le serveur au retour d'Internet.
    case "refresh_notifications": return ok(0);
    // convert_lead, log_member_export... : serveur requis.
    default: return runLocalWriteRpc(user, name, args) ?? NEEDS_INTERNET;
  }
}
