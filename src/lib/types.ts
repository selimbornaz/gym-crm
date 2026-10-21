/**
 * Types des lignes lues via PostgREST. Écrits à la main faute de projet
 * Supabase lors du développement : à remplacer à terme par
 * `supabase gen types typescript` (voir README).
 * Les colonnes numeric arrivent en `number` JSON ; on les traite comme des
 * valeurs d'affichage, jamais pour des calculs comptables (faits en SQL).
 */
export type MembershipStatus = "active" | "expiring" | "expired" | "suspended" | "none" | "archived";

export interface MemberRow {
  id: string;
  organization_id: string;
  member_code: string;
  first_name: string;
  last_name: string;
  full_name: string;
  photo_path: string | null;
  phone: string | null;
  email: string | null;
  birth_date: string | null;
  gender: "female" | "male" | "unspecified" | null;
  address: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  registered_on: string;
  coach_id: string | null;
  coach_name: string | null;
  archived_at: string | null;
  archive_reason: string | null;
  membership_end_date: string | null;
  membership_suspended: boolean;
  membership_status: MembershipStatus;
  created_at: string;
}

export interface PlanRow {
  id: string;
  name: string;
  kind: "membership" | "pass" | "pt_package";
  duration_value: number;
  duration_unit: "day" | "week" | "month" | "year";
  sessions_included: number | null;
  price: number;
  description: string | null;
  access_restrictions: string | null;
  is_active: boolean;
  sort_order: number;
}

export interface SubscriptionRow {
  id: string;
  member_id: string;
  member_code: string;
  member_name: string;
  member_phone: string | null;
  plan_id: string;
  plan_name: string;
  kind: PlanRow["kind"];
  start_date: string;
  end_date: string;
  price: number;
  discount: number;
  total_due: number;
  amount_paid: number;
  balance: number;
  payment_status: "paid" | "partial" | "unpaid";
  status: "active" | "suspended" | "cancelled";
  effective_status: "active" | "scheduled" | "expired" | "suspended" | "cancelled";
  sessions_included: number | null;
  sessions_used: number;
  suspended_on: string | null;
  cancel_reason: string | null;
  notes: string | null;
  created_at: string;
}

export interface PaymentRow {
  id: string;
  member_id: string;
  member_code: string;
  member_name: string;
  subscription_id: string | null;
  plan_name: string | null;
  method_id: string;
  method_name: string;
  amount: number;
  refunded_amount: number;
  net_amount: number;
  paid_at: string;
  receipt_number: string;
  reference: string | null;
  notes: string | null;
}

export interface PaymentMethodRow {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
}

export interface CoachRow {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  specialties: string[];
  bio: string | null;
  availability: Array<{ day: number; start: string; end: string }>;
  is_active: boolean;
  staff_id: string | null;
}
