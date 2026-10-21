import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { requirePagePermission } from "@/lib/auth/context";
import { LeadBoard, type LeadView } from "./lead-board";

export const metadata: Metadata = { title: "Prospects" };

export default async function LeadsPage() {
  const ctx = await requirePagePermission("leads.manage");
  const [{ data }, { data: coaches }] = await Promise.all([
    ctx.supabase
      .from("leads")
      .select("id, first_name, last_name, phone, email, goal, source, status, notes, trial_at, coach_id, lost_reason, converted_member_id, last_activity_at, created_at, coach:coaches(full_name)")
      .eq("organization_id", ctx.org.id)
      .order("last_activity_at", { ascending: false })
      .limit(500),
    ctx.supabase.from("coaches").select("id, full_name").eq("organization_id", ctx.org.id).eq("is_active", true).order("full_name"),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Prospects" description="Tunnel de vente : glissez une carte vers l'étape suivante, cliquez pour ouvrir la fiche." />
      <LeadBoard
        leads={(data ?? []) as unknown as LeadView[]}
        coaches={(coaches ?? []).map((c) => ({ id: c.id as string, label: c.full_name as string }))}
        canConvert={ctx.can("members.write")}
      />
    </div>
  );
}
