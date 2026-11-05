import "server-only";
import { randomUUID } from "node:crypto";
import { TABLE_COLUMNS } from "./columns.generated";
import { NEEDS_INTERNET, NOT_ALLOWED, failure, ok, type LocalResult } from "./errors";
import { tableByName } from "./schema";
import { applyBatch, getDevice, getMeta, nextDeviceNumber, rowsOf, type QueuedOp, type Row } from "./store";
import { addDays, dateInZone, orgTimezone, orgToday, roundMoney } from "./views";

/**
 * Écritures hors ligne : l'effet est visible tout de suite sur le poste, et
 * l'opération part dans la file, dans la même transaction. Au retour d'Internet,
 * PostgreSQL rejoue la file avec ses propres règles et reste seul juge : la copie
 * locale est alors remplacée par ce que le serveur a réellement accepté.
 * Les messages reprennent ceux des fonctions SQL (migrations 0004 et 0008).
 */
type Args = Record<string, unknown>;

/** Mêmes tables que sync_apply_row côté serveur, mêmes permissions que la RLS. */
const ROW_RULES: Record<string, { insert?: string[]; update?: string[]; delete?: string[] }> = {
  organizations: { update: ["settings.manage"] },
  organization_settings: { update: ["settings.manage"] },
  coaches: { insert: ["coaches.manage"], update: ["coaches.manage"] },
  members: { insert: ["members.write"], update: ["members.write"] },
  member_notes: { insert: ["member_notes.manage"], delete: ["member_notes.manage"] },
  leads: { insert: ["leads.manage"], update: ["leads.manage"], delete: ["leads.manage"] },
  membership_plans: { insert: ["plans.manage"], update: ["plans.manage"] },
  payment_methods: { insert: ["payment_methods.manage"], update: ["payment_methods.manage"] },
  expenses: { insert: ["expenses.manage"], update: ["expenses.manage"] },
  workout_programs: {
    insert: ["workouts.manage_all", "workouts.manage_assigned"],
    update: ["workouts.manage_all", "workouts.manage_assigned"],
    delete: ["workouts.manage_all", "workouts.manage_assigned"],
  },
  workout_days: {
    insert: ["workouts.manage_all", "workouts.manage_assigned"],
    update: ["workouts.manage_all", "workouts.manage_assigned"],
    delete: ["workouts.manage_all", "workouts.manage_assigned"],
  },
  workout_exercises: {
    insert: ["workouts.manage_all", "workouts.manage_assigned"],
    update: ["workouts.manage_all", "workouts.manage_assigned"],
    delete: ["workouts.manage_all", "workouts.manage_assigned"],
  },
  workout_logs: {
    insert: ["workouts.manage_all", "workouts.manage_assigned"],
    delete: ["workouts.manage_all", "workouts.manage_assigned"],
  },
  progress_entries: {
    insert: ["progress.manage_all", "progress.manage_assigned"],
    delete: ["progress.manage_all", "progress.manage_assigned"],
  },
  sessions: { insert: ["schedule.manage", "schedule.manage_own"], update: ["schedule.manage", "schedule.manage_own"] },
  bookings: { update: ["bookings.manage", "schedule.manage_own"] },
  equipment: { insert: ["equipment.manage"], update: ["equipment.manage"] },
  equipment_maintenance: { insert: ["equipment.manage"] },
  notifications: { update: ["notifications.read"] },
  announcements: { insert: ["announcements.manage"] },
};

/** Jamais envoyés au serveur : il les attribue lui-même. */
const SERVER_FIELDS = new Set(["id", "organization_id", "created_at", "updated_at", "row_version", "created_by", "recorded_by"]);

const permissionsOf = (user: string, org: unknown) => JSON.parse(getMeta(user, `permissions:${org}`) ?? "[]") as string[];
const hasAny = (user: string, org: unknown, perms: string[]) => {
  const mine = permissionsOf(user, org);
  return perms.some((p) => mine.includes(p));
};

const pkOf = (table: string) => tableByName.get(table)?.pk ?? "id";
const scope = (table: string, row: Row) => {
  const def = tableByName.get(table);
  return def?.org ? String(row[def.org]) : "";
};

function makeOp(user: string, org: unknown, kind: string, args: Args, occurredAt: string, label: string): QueuedOp {
  return { opId: randomUUID(), user, org: String(org), kind, args, occurredAt, label };
}

/** Ligne complète, avec les colonnes et valeurs par défaut du schéma réel. */
function completeRow(user: string, table: string, values: Row, now: string): Row {
  const row: Row = {};
  for (const column of TABLE_COLUMNS[table] ?? []) row[column.name] = column.value;
  Object.assign(row, values);
  if ("id" in row && !row.id) row.id = randomUUID();
  if ("created_at" in row) row.created_at = now;
  if ("updated_at" in row) row.updated_at = now;
  if ("created_by" in row) row.created_by = user;
  if ("recorded_by" in row) row.recorded_by = user;
  if ("row_version" in row) row.row_version = 1;
  row._offline = true;
  return row;
}

function deviceFor(org: unknown) {
  const device = getDevice(String(org));
  return device;
}

function phoneDigits(phone: unknown): string | null {
  const digits = String(phone ?? "").replace(/\D/g, "");
  return digits === "" ? null : digits;
}

// -----------------------------------------------------------------------------
// Lignes
// -----------------------------------------------------------------------------
export function localInsert(user: string, table: string, values: Row | Row[]): { result: LocalResult; rows: Row[] } {
  const rule = ROW_RULES[table]?.insert;
  if (!rule) return { result: NEEDS_INTERNET, rows: [] };
  const list = Array.isArray(values) ? values : [values];
  const now = new Date().toISOString();
  const rows: Row[] = [];
  const ops: QueuedOp[] = [];
  for (const raw of list) {
    const org = raw.organization_id;
    if (!hasAny(user, org, rule)) return { result: NOT_ALLOWED, rows: [] };
    const given = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined));
    const row = completeRow(user, table, { ...given, id: randomUUID() }, now);
    const sent: Row = Object.fromEntries(Object.entries(given).filter(([k]) => !SERVER_FIELDS.has(k)));

    if (table === "members") {
      const device = deviceFor(org);
      if (!device) return { result: NEEDS_INTERNET, rows: [] };
      const number = nextDeviceNumber(String(org), "member");
      row.member_code = `${device.memberPrefix}-${device.series}-${String(number).padStart(6, "0")}`;
      row.registered_on = (given.registered_on as string | undefined) ?? orgToday(user, org);
      row.phone_digits = phoneDigits(row.phone);
      sent.member_code = row.member_code;
      sent.registered_on = row.registered_on;
    }
    rows.push(row);
    ops.push(makeOp(user, org, "row.insert", { table, id: row.id, values: sent }, now, `Création : ${table}`));
  }
  const extra: Array<{ table: string; id: string; org: string; row: Row }> = [];
  // Effet du trigger maintenance_after_insert.
  if (table === "equipment_maintenance") {
    for (const m of rows) {
      const equipment = rowsOf(user, "equipment").find((e) => e.id === m.equipment_id);
      if (equipment) {
        extra.push({ table: "equipment", id: String(equipment.id), org: String(equipment.organization_id), row: { ...equipment, next_maintenance_on: m.next_due_on ?? null } });
      }
    }
  }
  applyBatch(user, {
    upsert: [...rows.map((row) => ({ table, id: String(row[pkOf(table)]), org: scope(table, row), row })), ...extra],
    enqueue: ops,
  });
  return { result: ok(rows, rows.length), rows };
}

export function localUpdate(user: string, table: string, patch: Row, targets: Row[]): { result: LocalResult; rows: Row[] } {
  const rule = ROW_RULES[table]?.update;
  if (!rule) return { result: NEEDS_INTERNET, rows: [] };
  const now = new Date().toISOString();
  const updated: Row[] = [];
  const ops: QueuedOp[] = [];
  const changes = Object.fromEntries(Object.entries(patch).filter(([k, v]) => v !== undefined && !SERVER_FIELDS.has(k)));
  for (const target of targets) {
    const org = table === "organizations" ? target.id : target.organization_id;
    if (!hasAny(user, org, rule)) return { result: NOT_ALLOWED, rows: [] };
    const base = Object.fromEntries(Object.keys(changes).map((k) => [k, target[k] ?? null]));
    const row: Row = { ...target, ...changes };
    if ("updated_at" in row) row.updated_at = now;
    if ("row_version" in row) row.row_version = Number(row.row_version ?? 1) + 1;
    if (table === "members" && "phone" in changes) row.phone_digits = phoneDigits(changes.phone);
    updated.push(row);
    if (Object.keys(changes).length > 0) {
      ops.push(makeOp(user, org, "row.update", { table, id: target[pkOf(table)], base, changes }, now, `Modification : ${table}`));
    }
  }
  applyBatch(user, {
    upsert: updated.map((row) => ({ table, id: String(row[pkOf(table)]), org: scope(table, row), row })),
    enqueue: ops,
  });
  return { result: ok(updated, updated.length), rows: updated };
}

export function localDelete(user: string, table: string, targets: Row[]): { result: LocalResult; rows: Row[] } {
  const rule = ROW_RULES[table]?.delete;
  if (!rule) return { result: NEEDS_INTERNET, rows: [] };
  const now = new Date().toISOString();
  const ops: QueuedOp[] = [];
  for (const target of targets) {
    if (!hasAny(user, target.organization_id, rule)) return { result: NOT_ALLOWED, rows: [] };
    ops.push(makeOp(user, target.organization_id, "row.delete", { table, id: target.id, base_version: target.row_version ?? 1 }, now, `Suppression : ${table}`));
  }
  applyBatch(user, { remove: targets.map((t) => ({ table, id: String(t.id) })), enqueue: ops });
  return { result: ok(targets, targets.length), rows: targets };
}

// -----------------------------------------------------------------------------
// Fonctions métier
// -----------------------------------------------------------------------------
const inOrg = (user: string, table: string, org: unknown) => rowsOf(user, table).filter((r) => r.organization_id === org);
const domainError = (message: string, code = "22023") => failure(code, message);

function addMonthsClamped(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

/** private.compute_end_date : 1 mois à partir du 15/01 => 14/02 inclus. */
export function computeEndDate(start: string, value: number, unit: string): string {
  switch (unit) {
    case "day": return addDays(start, value - 1);
    case "week": return addDays(start, value * 7 - 1);
    case "month": return addDays(addMonthsClamped(start, value), -1);
    case "year": return addDays(addMonthsClamped(start, value * 12), -1);
    default: throw new Error(`Unité inconnue : ${unit}`);
  }
}

const moneyText = (n: number) => {
  const [int, dec] = n.toFixed(3).split(".");
  return `${int!.replace(/\B(?=(\d{3})+(?!\d))/g, " ")},${dec} DT`;
};

/** Mêmes effets que private.refresh_member_membership. */
function memberSnapshot(user: string, org: unknown, memberId: unknown, subs: Row[]): Row | null {
  const member = inOrg(user, "members", org).find((m) => m.id === memberId);
  if (!member) return null;
  const mine = subs.filter((s) => s.member_id === memberId && s.status !== "cancelled");
  const ends = mine.filter((s) => s.kind === "membership" || s.kind === "pass").map((s) => s.end_date as string);
  return {
    ...member,
    membership_end_date: ends.length ? ends.sort().at(-1)! : null,
    membership_suspended: mine.some((s) => s.status === "suspended"),
  };
}

function subscriptionTarget(user: string, org: unknown, id: unknown) {
  const sub = inOrg(user, "subscriptions", org).find((s) => s.id === id);
  if (!sub) return null;
  // Abonnement créé hors ligne : le serveur le retrouve par son identifiant de requête.
  return { sub, ref: sub._offline ? { subscription_request: sub.request_id } : { subscription: sub.id } };
}

function subscriptionEvent(user: string, org: unknown, subId: unknown, type: string, reason: unknown, days: number | null, now: string): { table: string; id: string; org: string; row: Row } {
  const id = `local-${randomUUID()}`;
  return {
    table: "subscription_events", id, org: String(org),
    row: { ...completeRow(user, "subscription_events", { organization_id: org, subscription_id: subId, event_type: type, days, reason: reason ?? null }, now), id, actor_user_id: user },
  };
}

function saveSubscription(user: string, org: unknown, sub: Row, type: string, reason: unknown, days: number | null, op: QueuedOp, now: string) {
  const all = inOrg(user, "subscriptions", org).map((s) => (s.id === sub.id ? sub : s));
  if (!all.some((s) => s.id === sub.id)) all.push(sub);
  const member = memberSnapshot(user, org, sub.member_id, all);
  applyBatch(user, {
    upsert: [
      { table: "subscriptions", id: String(sub.id), org: String(org), row: sub },
      subscriptionEvent(user, org, sub.id, type, reason, days, now),
      ...(member ? [{ table: "members", id: String(member.id), org: String(org), row: member }] : []),
    ],
    enqueue: [op],
  });
}

function checkIn(user: string, a: Args): LocalResult {
  const org = a.p_org;
  const perms = permissionsOf(user, org);
  if (!perms.includes("attendance.write")) return NOT_ALLOWED;
  const member = inOrg(user, "members", org).find((m) => m.id === a.p_member);
  if (!member) return domainError("Membre introuvable", "P0002");

  const now = new Date();
  const nowIso = now.toISOString();
  const tz = orgTimezone(user, org);
  const today = dateInZone(now, tz);
  const plans = new Map(inOrg(user, "membership_plans", org).map((p) => [p.id, p]));
  const current = inOrg(user, "subscriptions", org)
    .filter((s) => s.member_id === a.p_member && (s.kind === "membership" || s.kind === "pass") && s.status !== "cancelled"
      && (s.start_date as string) <= today && (s.end_date as string) >= today)
    .sort((x, y) => ((x.end_date as string) < (y.end_date as string) ? 1 : -1))[0];
  const end = (member.membership_end_date as string | null) ?? null;
  const formatFr = (d: string) => d.split("-").reverse().join("/");

  const payload = {
    member: { id: member.id, code: member.member_code, name: `${member.first_name} ${member.last_name}`, photo_path: member.photo_path ?? null },
    membership: {
      plan: current?.plan_name ?? null,
      end_date: current?.end_date ?? end,
      access_restrictions: current ? (plans.get(current.plan_id)?.access_restrictions ?? null) : null,
    },
  };
  const denial = member.archived_at ? "Membre archivé"
    : current?.status === "suspended" ? "Abonnement suspendu"
    : !current && end !== null && end < today ? `Abonnement expiré le ${formatFr(end)}`
    : !current && end !== null && end > today ? "L'abonnement n'a pas encore commencé"
    : !current ? "Aucun abonnement valide aujourd'hui"
    : null;

  const settings = rowsOf(user, "organization_settings").find((s) => s.organization_id === org);
  const debounceMs = Number(settings?.checkin_debounce_minutes ?? 5) * 60_000;
  const recent = inOrg(user, "attendance", org)
    .filter((x) => x.member_id === a.p_member && x.status === "valid" && Math.abs(Date.parse(x.checked_in_at as string) - now.getTime()) < debounceMs)
    .sort((x, y) => Date.parse(y.checked_in_at as string) - Date.parse(x.checked_in_at as string))[0];
  if (recent) {
    return ok({ ...payload, result: "duplicate", attendance_id: recent.id, checked_in_at: recent.checked_in_at, message: "Entrée déjà enregistrée il y a quelques minutes" });
  }

  const reason = a.p_override_reason ? String(a.p_override_reason).trim() : "";
  if (denial) {
    if (reason.length < 3) {
      return ok({ ...payload, result: "denied", message: denial, can_override: perms.includes("attendance.override") && !member.archived_at });
    }
    if (!perms.includes("attendance.override")) return NOT_ALLOWED;
    if (member.archived_at) return domainError("Membre archivé : entrée impossible");
  }

  const row = completeRow(user, "attendance", {
    id: randomUUID(), organization_id: org, member_id: a.p_member, checked_in_at: nowIso, method: a.p_method,
    override_reason: denial ? reason : null,
  }, nowIso);
  applyBatch(user, {
    upsert: [{ table: "attendance", id: String(row.id), org: String(org), row }],
    enqueue: [makeOp(user, org, "check_in", { member: a.p_member, method: a.p_method, override_reason: denial ? reason : null, row_id: row.id }, nowIso, "Entrée")],
  });
  return ok({
    ...payload, result: "granted", attendance_id: row.id, checked_in_at: nowIso, overridden: denial !== null,
    message: denial ? `Entrée forcée : ${denial}` : "Accès autorisé",
  });
}

function checkOut(user: string, a: Args): LocalResult {
  const org = a.p_org;
  if (!permissionsOf(user, org).includes("attendance.write")) return NOT_ALLOWED;
  const row = inOrg(user, "attendance", org).find((x) => x.id === a.p_attendance && !x.checked_out_at && x.status === "valid");
  if (!row) return domainError("Passage introuvable ou déjà clôturé", "P0002");
  const now = new Date().toISOString();
  applyBatch(user, {
    upsert: [{ table: "attendance", id: String(row.id), org: String(org), row: { ...row, checked_out_at: now, updated_at: now } }],
    enqueue: [makeOp(user, org, "check_out", { attendance: row.id }, now, "Sortie")],
  });
  return ok(null);
}

function correctAttendance(user: string, a: Args): LocalResult {
  const org = a.p_org;
  if (!permissionsOf(user, org).includes("attendance.correct")) return NOT_ALLOWED;
  if (String(a.p_reason ?? "").trim().length < 3) return domainError("Motif obligatoire");
  const row = inOrg(user, "attendance", org).find((x) => x.id === a.p_attendance);
  if (!row) return domainError("Passage introuvable", "P0002");
  const now = new Date().toISOString();
  const next: Row = {
    ...row,
    status: a.p_void ? "voided" : row.status,
    checked_in_at: a.p_checked_in_at ?? row.checked_in_at,
    checked_out_at: a.p_checked_out_at ?? row.checked_out_at,
    correction_reason: String(a.p_reason).trim(),
    updated_at: now,
  };
  applyBatch(user, {
    upsert: [{ table: "attendance", id: String(row.id), org: String(org), row: next }],
    enqueue: [makeOp(user, org, "correct_attendance", { attendance: row.id, reason: a.p_reason, void: Boolean(a.p_void), checked_in_at: a.p_checked_in_at ?? null, checked_out_at: a.p_checked_out_at ?? null }, now, "Correction de passage")],
  });
  return ok(null);
}

function createSubscription(user: string, a: Args): LocalResult {
  const org = a.p_org;
  if (!permissionsOf(user, org).includes("subscriptions.write")) return NOT_ALLOWED;
  const subs = inOrg(user, "subscriptions", org);
  const existing = subs.find((s) => s.request_id === a.p_request_id);
  if (existing) return ok(existing.id);

  const member = inOrg(user, "members", org).find((m) => m.id === a.p_member);
  if (!member) return domainError("Membre introuvable", "P0002");
  if (member.archived_at) return domainError("Ce membre est archivé");
  const plan = inOrg(user, "membership_plans", org).find((p) => p.id === a.p_plan);
  if (!plan || !plan.is_active) return domainError("Formule introuvable ou inactive");

  const price = Number(plan.price);
  const discount = roundMoney(Number(a.p_discount ?? 0));
  if (discount < 0 || discount > price) return domainError("Remise invalide (entre 0 et le prix de la formule)");

  const today = orgToday(user, org);
  const mine = subs.filter((s) => s.member_id === a.p_member && s.status !== "cancelled");
  const hasPrevious = mine.some((s) => s.kind === plan.kind);
  let start: string;
  if (a.p_start) {
    start = String(a.p_start);
  } else if (plan.kind === "membership") {
    const ends = mine.filter((s) => s.kind === "membership").map((s) => s.end_date as string).sort();
    const next = ends.length ? addDays(ends.at(-1)!, 1) : today;
    start = next > today ? next : today;
  } else {
    start = today;
  }
  if (start < addDays(today, -31)) return domainError("La date de début ne peut pas remonter à plus de 31 jours");
  const end = computeEndDate(start, Number(plan.duration_value), String(plan.duration_unit));

  if (plan.kind === "membership" && mine.some((s) => s.kind === "membership" && (s.start_date as string) <= end && (s.end_date as string) >= start)) {
    return domainError("Ce membre a déjà une adhésion sur cette période (renouvellement en double ?)", "23P01");
  }

  const now = new Date().toISOString();
  const notes = a.p_notes ? String(a.p_notes).trim() || null : null;
  const row = completeRow(user, "subscriptions", {
    id: randomUUID(), organization_id: org, member_id: a.p_member, plan_id: a.p_plan, plan_name: plan.name, kind: plan.kind,
    start_date: start, end_date: end, price, discount, total_due: roundMoney(price - discount), amount_paid: 0,
    sessions_included: plan.sessions_included ?? null, notes, request_id: a.p_request_id,
  }, now);
  const op = makeOp(user, org, "create_subscription", { member: a.p_member, plan: a.p_plan, request_id: a.p_request_id, start, discount, notes }, now, "Abonnement");
  saveSubscription(user, org, row, hasPrevious ? "renewed" : "created", notes, null, op, now);
  return ok(row.id);
}

function suspendSubscription(user: string, a: Args): LocalResult {
  const org = a.p_org;
  if (!permissionsOf(user, org).includes("subscriptions.manage")) return NOT_ALLOWED;
  if (String(a.p_reason ?? "").trim().length < 3) return domainError("Motif obligatoire");
  const target = subscriptionTarget(user, org, a.p_sub);
  if (!target) return domainError("Abonnement introuvable", "P0002");
  const today = orgToday(user, org);
  const { sub, ref } = target;
  if (sub.status !== "active" || (sub.end_date as string) < today) return domainError("Seul un abonnement en cours peut être suspendu");
  const now = new Date().toISOString();
  const next = { ...sub, status: "suspended", suspended_on: today > (sub.start_date as string) ? today : sub.start_date, updated_at: now };
  saveSubscription(user, org, next, "suspended", a.p_reason, null, makeOp(user, org, "suspend_subscription", { ...ref, reason: a.p_reason }, now, "Suspension d'abonnement"), now);
  return ok(null);
}

function resumeSubscription(user: string, a: Args): LocalResult {
  const org = a.p_org;
  if (!permissionsOf(user, org).includes("subscriptions.manage")) return NOT_ALLOWED;
  const target = subscriptionTarget(user, org, a.p_sub);
  if (!target) return domainError("Abonnement introuvable", "P0002");
  const { sub, ref } = target;
  if (sub.status !== "suspended") return domainError("Cet abonnement n'est pas suspendu");
  const today = orgToday(user, org);
  const frozen = Math.round((Date.parse(today) - Date.parse(sub.suspended_on as string)) / 86_400_000);
  const days = Math.max(frozen, 0);
  const now = new Date().toISOString();
  const next = { ...sub, status: "active", suspended_on: null, end_date: addDays(sub.end_date as string, days), updated_at: now };
  saveSubscription(user, org, next, "resumed", a.p_reason ?? null, days, makeOp(user, org, "resume_subscription", { ...ref, reason: a.p_reason ?? null }, now, "Reprise d'abonnement"), now);
  return ok(days);
}

function cancelSubscription(user: string, a: Args): LocalResult {
  const org = a.p_org;
  if (!permissionsOf(user, org).includes("subscriptions.manage")) return NOT_ALLOWED;
  if (String(a.p_reason ?? "").trim().length < 3) return domainError("Motif obligatoire");
  const target = subscriptionTarget(user, org, a.p_sub);
  if (!target) return domainError("Abonnement introuvable", "P0002");
  const { sub, ref } = target;
  if (sub.status === "cancelled") return domainError("Abonnement déjà annulé");
  const now = new Date().toISOString();
  const next = { ...sub, status: "cancelled", cancelled_at: now, cancel_reason: a.p_reason, suspended_on: null, updated_at: now };
  saveSubscription(user, org, next, "cancelled", a.p_reason, null, makeOp(user, org, "cancel_subscription", { ...ref, reason: a.p_reason }, now, "Annulation d'abonnement"), now);
  return ok(null);
}

function extendSubscription(user: string, a: Args): LocalResult {
  const org = a.p_org;
  if (!permissionsOf(user, org).includes("subscriptions.manage")) return NOT_ALLOWED;
  const days = Number(a.p_days);
  if (!Number.isInteger(days) || days < 1 || days > 365) return domainError("Durée invalide (1 à 365 jours)");
  if (String(a.p_reason ?? "").trim().length < 3) return domainError("Motif obligatoire");
  const target = subscriptionTarget(user, org, a.p_sub);
  if (!target) return domainError("Abonnement introuvable", "P0002");
  const { sub, ref } = target;
  if (sub.status === "cancelled") return domainError("Impossible de prolonger un abonnement annulé");
  const now = new Date().toISOString();
  const end = addDays(sub.end_date as string, days);
  saveSubscription(user, org, { ...sub, end_date: end, updated_at: now }, "extended", a.p_reason, days, makeOp(user, org, "extend_subscription", { ...ref, days, reason: a.p_reason }, now, "Prolongation d'abonnement"), now);
  return ok(end);
}

function recordPayment(user: string, a: Args): LocalResult {
  const org = a.p_org;
  const perms = permissionsOf(user, org);
  if (!perms.includes("payments.create")) return NOT_ALLOWED;
  const existing = inOrg(user, "payments", org).find((p) => p.request_id === a.p_request_id);
  if (existing) return ok([{ payment_id: existing.id, receipt_number: existing.receipt_number }]);

  const amount = Number(a.p_amount);
  if (!(amount > 0) || amount !== roundMoney(amount)) return domainError("Montant invalide (positif, 3 décimales max.)");
  const paidAt = a.p_paid_at ? new Date(String(a.p_paid_at)) : new Date();
  if (paidAt.getTime() > Date.now() + 5 * 60_000) return domainError("La date de paiement ne peut pas être dans le futur");
  if (paidAt.getTime() < Date.now() - 86_400_000 && !perms.includes("reports.financial")) {
    return domainError("Seul le propriétaire peut antidater un paiement", "42501");
  }
  if (!inOrg(user, "members", org).some((m) => m.id === a.p_member)) return domainError("Membre introuvable", "P0002");
  if (!inOrg(user, "payment_methods", org).some((m) => m.id === a.p_method && m.is_active)) return domainError("Moyen de paiement invalide");

  let ref: Row = {};
  const upsert: Array<{ table: string; id: string; org: string; row: Row }> = [];
  const now = new Date().toISOString();
  if (a.p_subscription) {
    const target = subscriptionTarget(user, org, a.p_subscription);
    if (!target) return domainError("Abonnement introuvable", "P0002");
    const { sub } = target;
    ref = target.ref;
    if (sub.member_id !== a.p_member) return domainError("Abonnement d'un autre membre");
    if (sub.status === "cancelled") return domainError("Abonnement annulé");
    const remaining = roundMoney(Number(sub.total_due) - Number(sub.amount_paid));
    if (amount > remaining) return domainError(`Le montant dépasse le reste à payer (${moneyText(remaining)})`);
    upsert.push({ table: "subscriptions", id: String(sub.id), org: String(org), row: { ...sub, amount_paid: roundMoney(Number(sub.amount_paid) + amount), updated_at: now } });
  }

  const device = deviceFor(org);
  if (!device) return NEEDS_INTERNET;
  const year = dateInZone(paidAt, orgTimezone(user, org)).slice(0, 4);
  const receipt = `${device.receiptPrefix}-${device.series}-${year}-${String(nextDeviceNumber(String(org), "receipt")).padStart(6, "0")}`;
  const reference = a.p_reference ? String(a.p_reference).trim() || null : null;
  const notes = a.p_notes ? String(a.p_notes).trim() || null : null;
  const row = completeRow(user, "payments", {
    id: randomUUID(), organization_id: org, member_id: a.p_member, subscription_id: a.p_subscription ?? null, method_id: a.p_method,
    amount, refunded_amount: 0, paid_at: paidAt.toISOString(), receipt_number: receipt, reference, notes, request_id: a.p_request_id,
  }, now);
  upsert.push({ table: "payments", id: String(row.id), org: String(org), row });
  applyBatch(user, {
    upsert,
    enqueue: [makeOp(user, org, "record_payment", { member: a.p_member, method: a.p_method, amount, request_id: a.p_request_id, ...ref, reference, notes, receipt_number: receipt }, paidAt.toISOString(), "Paiement")],
  });
  return ok([{ payment_id: row.id, receipt_number: receipt }]);
}

function refundPayment(user: string, a: Args): LocalResult {
  const org = a.p_org;
  if (!permissionsOf(user, org).includes("payments.refund")) return NOT_ALLOWED;
  const existing = inOrg(user, "payment_adjustments", org).find((x) => x.request_id === a.p_request_id);
  if (existing) return ok(existing.id);
  if (String(a.p_reason ?? "").trim().length < 3) return domainError("Motif obligatoire");
  const pay = inOrg(user, "payments", org).find((p) => p.id === a.p_payment);
  if (!pay) return domainError("Paiement introuvable", "P0002");
  const remaining = roundMoney(Number(pay.amount) - Number(pay.refunded_amount));
  const amount = a.p_type === "reversal" ? remaining : Number(a.p_amount);
  if (!(amount > 0) || amount !== roundMoney(amount) || amount > remaining) {
    return domainError(`Montant invalide (max. ${moneyText(remaining)} remboursables)`);
  }
  const now = new Date().toISOString();
  const reason = String(a.p_reason).trim();
  const adjustment = completeRow(user, "payment_adjustments", {
    id: randomUUID(), organization_id: org, payment_id: pay.id, type: a.p_type, amount, reason,
    method_id: a.p_method ?? pay.method_id, request_id: a.p_request_id, approved_by: user,
  }, now);
  const upsert: Array<{ table: string; id: string; org: string; row: Row }> = [
    { table: "payment_adjustments", id: String(adjustment.id), org: String(org), row: adjustment },
    { table: "payments", id: String(pay.id), org: String(org), row: { ...pay, refunded_amount: roundMoney(Number(pay.refunded_amount) + amount) } },
  ];
  if (pay.subscription_id) {
    const sub = inOrg(user, "subscriptions", org).find((s) => s.id === pay.subscription_id);
    if (sub) upsert.push({ table: "subscriptions", id: String(sub.id), org: String(org), row: { ...sub, amount_paid: roundMoney(Number(sub.amount_paid) - amount), updated_at: now } });
  }
  const ref = pay._offline ? { payment_request: pay.request_id } : { payment: pay.id };
  applyBatch(user, {
    upsert,
    enqueue: [makeOp(user, org, "refund_payment", { ...ref, type: a.p_type, amount, reason, request_id: a.p_request_id, method: a.p_method ?? null }, now, "Remboursement")],
  });
  return ok(adjustment.id);
}

function bookSession(user: string, a: Args): LocalResult {
  const org = a.p_org;
  const session = inOrg(user, "sessions", org).find((s) => s.id === a.p_session);
  if (!session) return domainError("Séance introuvable", "P0002");
  const member = inOrg(user, "members", org).find((m) => m.id === a.p_member);
  if (!member) return domainError("Membre introuvable", "P0002");
  const perms = permissionsOf(user, org);
  if (!perms.includes("bookings.manage") && !perms.includes("schedule.manage_own")) return NOT_ALLOWED;
  if (session.status !== "scheduled") return domainError("Séance annulée ou terminée");
  if (Date.parse(session.starts_at as string) <= Date.now()) return domainError("La séance a déjà commencé");
  if (member.archived_at) return domainError("Membre archivé");
  const bookings = inOrg(user, "bookings", org).filter((b) => b.session_id === a.p_session);
  if (bookings.some((b) => b.member_id === a.p_member && b.status === "booked")) return domainError("Ce membre est déjà inscrit", "23505");
  const booked = bookings.filter((b) => b.status === "booked").length;
  if (booked >= Number(session.capacity)) return domainError(`Séance complète (${booked} / ${session.capacity} places)`, "23514");

  const now = new Date().toISOString();
  const previous = bookings.find((b) => b.member_id === a.p_member);
  const row: Row = previous
    ? { ...previous, status: "booked", cancelled_at: null, updated_at: now }
    : completeRow(user, "bookings", { id: randomUUID(), organization_id: org, session_id: a.p_session, member_id: a.p_member, status: "booked" }, now);
  applyBatch(user, {
    upsert: [{ table: "bookings", id: String(row.id), org: String(org), row }],
    enqueue: [makeOp(user, org, "book_session", { session: a.p_session, member: a.p_member, local_id: row.id }, now, "Réservation")],
  });
  return ok(row.id);
}

function cancelBooking(user: string, a: Args): LocalResult {
  const org = a.p_org;
  const row = inOrg(user, "bookings", org).find((b) => b.id === a.p_booking);
  if (!row) return domainError("Réservation introuvable", "P0002");
  const perms = permissionsOf(user, org);
  if (!perms.includes("bookings.manage") && !perms.includes("schedule.manage_own")) return NOT_ALLOWED;
  const now = new Date().toISOString();
  applyBatch(user, {
    upsert: row.status === "booked" ? [{ table: "bookings", id: String(row.id), org: String(org), row: { ...row, status: "cancelled", cancelled_at: now, updated_at: now } }] : [],
    enqueue: [makeOp(user, org, "cancel_booking", { booking: row.id }, now, "Annulation de réservation")],
  });
  return ok(null);
}

const WRITE_RPCS: Record<string, (user: string, a: Args) => LocalResult> = {
  check_in: checkIn,
  check_out: checkOut,
  correct_attendance: correctAttendance,
  create_subscription: createSubscription,
  suspend_subscription: suspendSubscription,
  resume_subscription: resumeSubscription,
  cancel_subscription: cancelSubscription,
  extend_subscription: extendSubscription,
  record_payment: recordPayment,
  refund_payment: refundPayment,
  book_session: bookSession,
  cancel_booking: cancelBooking,
};

/** null : ce n'est pas une fonction d'écriture connue. */
export function runLocalWriteRpc(user: string, name: string, args: Args): LocalResult | null {
  const handler = WRITE_RPCS[name];
  return handler ? handler(user, args) : null;
}
