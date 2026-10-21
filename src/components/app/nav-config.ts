import {
  Activity,
  BarChart3,
  CalendarDays,
  ClipboardList,
  CreditCard,
  Dumbbell,
  LayoutDashboard,
  type LucideIcon,
  ReceiptText,
  ScrollText,
  Settings,
  ShieldCheck,
  UserCog,
  UserPlus,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";
import type { Permission } from "@/lib/permissions";
import { t } from "@/i18n";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Visible si l'utilisateur possède AU MOINS une de ces permissions. */
  anyOf: Permission[];
}

export const NAV_SECTIONS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "Accueil",
    items: [
      { href: "/dashboard", label: t.nav.dashboard, icon: LayoutDashboard, anyOf: ["dashboard.view"] },
      { href: "/attendance", label: t.nav.attendance, icon: Activity, anyOf: ["attendance.write", "attendance.read", "attendance.read_assigned"] },
      { href: "/members", label: t.nav.members, icon: Users, anyOf: ["members.read_all", "members.read_assigned"] },
      { href: "/leads", label: t.nav.leads, icon: UserPlus, anyOf: ["leads.manage"] },
    ],
  },
  {
    title: "Ventes",
    items: [
      { href: "/subscriptions", label: t.nav.subscriptions, icon: ReceiptText, anyOf: ["subscriptions.read"] },
      { href: "/payments", label: t.nav.payments, icon: CreditCard, anyOf: ["payments.read"] },
    ],
  },
  {
    title: "Activité",
    items: [
      { href: "/schedule", label: t.nav.schedule, icon: CalendarDays, anyOf: ["schedule.read"] },
      { href: "/coaches", label: t.nav.coaches, icon: Dumbbell, anyOf: ["coaches.read"] },
      { href: "/workouts", label: t.nav.workouts, icon: ClipboardList, anyOf: ["workouts.manage_all", "workouts.manage_assigned"] },
      { href: "/equipment", label: t.nav.equipment, icon: Wrench, anyOf: ["equipment.read"] },
    ],
  },
  {
    title: "Gestion",
    items: [
      { href: "/reports", label: t.nav.reports, icon: BarChart3, anyOf: ["reports.financial"] },
      { href: "/expenses", label: t.nav.expenses, icon: Wallet, anyOf: ["expenses.manage"] },
      { href: "/staff", label: t.nav.staff, icon: UserCog, anyOf: ["staff.manage"] },
      { href: "/audit", label: t.nav.audit, icon: ScrollText, anyOf: ["audit.read"] },
      { href: "/settings", label: t.nav.settings, icon: Settings, anyOf: ["settings.manage"] },
    ],
  },
];

export const SECURITY_ICON = ShieldCheck;

export function visibleSections(permissions: readonly string[]) {
  const set = new Set(permissions);
  return NAV_SECTIONS.map((s) => ({ ...s, items: s.items.filter((i) => i.anyOf.some((p) => set.has(p))) })).filter(
    (s) => s.items.length > 0,
  );
}
