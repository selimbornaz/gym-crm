/**
 * Permissions applicatives. La SOURCE DE VÉRITÉ est la table
 * private.role_permissions (base) : l'interface reçoit la liste effective via
 * la RPC `my_permissions` et ne s'en sert que pour masquer des boutons.
 * Chaque action serveur revérifie, et la RLS / les RPC revérifient encore.
 */
export const PERMISSIONS = [
  "dashboard.view", "dashboard.financial",
  "members.read_all", "members.read_assigned", "members.write", "members.archive", "members.export", "member_notes.manage",
  "leads.manage",
  "plans.read", "plans.manage",
  "subscriptions.read", "subscriptions.write", "subscriptions.manage",
  "payments.read", "payments.create", "payments.refund", "payment_methods.manage",
  "expenses.manage", "reports.financial",
  "attendance.read", "attendance.read_assigned", "attendance.write", "attendance.correct", "attendance.override",
  "coaches.read", "coaches.manage",
  "workouts.manage_all", "workouts.manage_assigned", "progress.manage_all", "progress.manage_assigned",
  "schedule.read", "schedule.manage", "schedule.manage_own", "bookings.manage",
  "notifications.read", "announcements.manage",
  "equipment.read", "equipment.manage",
  "staff.manage", "settings.manage", "audit.read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export type StaffRole = "owner" | "receptionist" | "coach";

export function hasAny(granted: ReadonlySet<string>, ...perms: Permission[]): boolean {
  return perms.some((p) => granted.has(p));
}
