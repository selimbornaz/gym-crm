import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { requirePagePermission } from "@/lib/auth/context";
import type { MemberRow } from "@/lib/types";
import { MemberForm } from "../../member-form";

export const metadata: Metadata = { title: "Modifier le membre" };

export default async function EditMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePagePermission("members.write");
  const [{ data: member }, { data: coaches }] = await Promise.all([
    ctx.supabase.from("member_directory").select("*").eq("organization_id", ctx.org.id).eq("id", id).maybeSingle(),
    ctx.supabase.from("coaches").select("id, full_name").eq("organization_id", ctx.org.id).eq("is_active", true).order("full_name"),
  ]);
  if (!member) notFound();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title={`Modifier ${member.full_name}`} description={`N° ${member.member_code}`} />
      <MemberForm member={member as MemberRow} coaches={coaches ?? []} />
    </div>
  );
}
