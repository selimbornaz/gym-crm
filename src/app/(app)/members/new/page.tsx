import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { requirePagePermission } from "@/lib/auth/context";
import { MemberForm } from "../member-form";

export const metadata: Metadata = { title: "Nouveau membre" };

export default async function NewMemberPage() {
  const ctx = await requirePagePermission("members.write");
  const { data: coaches } = await ctx.supabase
    .from("coaches")
    .select("id, full_name")
    .eq("organization_id", ctx.org.id)
    .eq("is_active", true)
    .order("full_name");

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title="Nouveau membre" description="Le numéro de membre est attribué automatiquement." />
      <MemberForm coaches={coaches ?? []} />
    </div>
  );
}
