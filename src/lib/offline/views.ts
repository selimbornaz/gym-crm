import "server-only";
import { rowsOf, type Row } from "./store";

/**
 * Équivalents locaux des vues member_directory, subscription_overview et
 * payment_ledger (migration 0004). Les mêmes colonnes sont calculées avec les
 * mêmes règles ; le test hors ligne les compare aux vues PostgreSQL réelles.
 */

/** Évite les erreurs d'arrondi : les montants ont au plus 3 décimales. */
export const roundMoney = (n: number) => Math.round(n * 1000) / 1000;

export function orgTimezone(user: string, org: unknown): string {
  const row = rowsOf(user, "organizations").find((o) => o.id === org);
  return (row?.timezone as string | undefined) ?? "Africa/Tunis";
}

export function dateInZone(at: Date | string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(typeof at === "string" ? new Date(at) : at);
}

export const orgToday = (user: string, org: unknown) => dateInZone(new Date(), orgTimezone(user, org));

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function membershipStatus(archivedAt: unknown, suspended: unknown, end: string | null, today: string, alertDays: number): string {
  if (archivedAt) return "archived";
  if (suspended) return "suspended";
  if (!end) return "none";
  if (end < today) return "expired";
  if (end <= addDays(today, alertDays)) return "expiring";
  return "active";
}

const indexById = (rows: Row[]) => new Map(rows.map((r) => [r.id, r]));

/**
 * Les vues ont été créées avant row_version et checkin_pin (`m.*` est figé à la
 * création de la vue) : elles n'exposent pas ces colonnes.
 */
function withoutVersion(row: Row): Row {
  const { row_version: _version, checkin_pin: _pin, ...rest } = row;
  return rest;
}

export function viewRows(user: string, view: string): Row[] {
  switch (view) {
    case "member_directory": {
      const coaches = indexById(rowsOf(user, "coaches"));
      const settings = new Map(rowsOf(user, "organization_settings").map((s) => [s.organization_id, s]));
      return rowsOf(user, "members").map((m) => ({
        ...withoutVersion(m),
        full_name: `${m.first_name} ${m.last_name}`,
        coach_name: (coaches.get(m.coach_id)?.full_name as string | undefined) ?? null,
        membership_status: membershipStatus(
          m.archived_at, m.membership_suspended, (m.membership_end_date as string | null) ?? null,
          orgToday(user, m.organization_id), (settings.get(m.organization_id)?.expiry_alert_days as number | undefined) ?? 7,
        ),
      }));
    }
    case "subscription_overview": {
      const members = indexById(rowsOf(user, "members"));
      return rowsOf(user, "subscriptions").flatMap((s) => {
        const m = members.get(s.member_id);
        if (!m) return [];
        const due = Number(s.total_due);
        const paid = Number(s.amount_paid);
        const today = orgToday(user, s.organization_id);
        return [{
          ...withoutVersion(s),
          balance: roundMoney(due - paid),
          payment_status: paid <= 0 && due > 0 ? "unpaid" : paid < due ? "partial" : "paid",
          effective_status:
            s.status === "cancelled" ? "cancelled"
            : s.status === "suspended" ? "suspended"
            : (s.start_date as string) > today ? "scheduled"
            : (s.end_date as string) < today ? "expired"
            : "active",
          member_code: m.member_code,
          member_name: `${m.first_name} ${m.last_name}`,
          member_phone: m.phone ?? null,
        }];
      });
    }
    case "payment_ledger": {
      const members = indexById(rowsOf(user, "members"));
      const methods = indexById(rowsOf(user, "payment_methods"));
      const subscriptions = indexById(rowsOf(user, "subscriptions"));
      return rowsOf(user, "payments").flatMap((p) => {
        const m = members.get(p.member_id);
        const method = methods.get(p.method_id);
        if (!m || !method) return [];
        return [{
          ...p,
          net_amount: roundMoney(Number(p.amount) - Number(p.refunded_amount)),
          method_name: method.name,
          member_code: m.member_code,
          member_name: `${m.first_name} ${m.last_name}`,
          plan_name: (subscriptions.get(p.subscription_id)?.plan_name as string | undefined) ?? null,
        }];
      });
    }
    default:
      throw new Error(`Vue hors ligne inconnue : ${view}`);
  }
}
