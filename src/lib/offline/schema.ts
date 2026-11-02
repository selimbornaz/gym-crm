/** Tables copiées sur le poste, avec leur clé primaire et leur portée. */
export interface SyncTable {
  name: string;
  pk: string;
  /** Colonne de salle ; null pour les profils, communs à toutes les salles. */
  org: string | null;
}

export const SYNC_TABLES: SyncTable[] = [
  { name: "organizations", pk: "id", org: "id" },
  { name: "organization_settings", pk: "organization_id", org: "organization_id" },
  { name: "profiles", pk: "id", org: null },
  ...[
    "staff", "audit_logs", "coaches", "members", "member_notes", "leads", "membership_plans", "subscriptions",
    "subscription_events", "payment_methods", "payments", "payment_adjustments", "expenses", "attendance",
    "workout_programs", "workout_days", "workout_exercises", "workout_logs", "progress_entries", "sessions",
    "bookings", "equipment", "equipment_maintenance", "notifications", "announcements",
  ].map((name) => ({ name, pk: "id", org: "organization_id" })),
];

export const tableByName = new Map(SYNC_TABLES.map((t) => [t.name, t]));

export interface Relation {
  /** one : la ligne porte la clé étrangère. many : les lignes liées la portent. */
  kind: "one" | "many";
  local: string;
  foreign: string;
}

/** Relations résolues par PostgREST en ligne, déclarées ici pour le mode hors ligne. */
export const RELATIONS: Record<string, Record<string, Relation>> = {
  staff: {
    profiles: { kind: "one", local: "user_id", foreign: "id" },
    organizations: { kind: "one", local: "organization_id", foreign: "id" },
  },
  coaches: { staff: { kind: "one", local: "staff_id", foreign: "id" } },
  sessions: {
    coaches: { kind: "one", local: "coach_id", foreign: "id" },
    bookings: { kind: "many", local: "id", foreign: "session_id" },
  },
  bookings: { members: { kind: "one", local: "member_id", foreign: "id" } },
  workout_programs: {
    members: { kind: "one", local: "member_id", foreign: "id" },
    coaches: { kind: "one", local: "coach_id", foreign: "id" },
  },
  workout_days: { workout_exercises: { kind: "many", local: "id", foreign: "day_id" } },
  attendance: { members: { kind: "one", local: "member_id", foreign: "id" } },
  leads: { coaches: { kind: "one", local: "coach_id", foreign: "id" } },
  equipment: { equipment_maintenance: { kind: "many", local: "id", foreign: "equipment_id" } },
};

/** Vues calculées : une ligne par ligne de la table de base. */
export const VIEW_TABLES = new Set(["member_directory", "subscription_overview", "payment_ledger"]);
