import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, Plus } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { requirePagePermission } from "@/lib/auth/context";
import { formatDate } from "@/lib/format";
import { t } from "@/i18n";
import { ProgramDialog } from "./workout-dialogs";

export const metadata: Metadata = { title: "Programmes" };

interface ProgramListRow {
  id: string;
  name: string;
  status: keyof typeof t.programStatus;
  start_date: string | null;
  end_date: string | null;
  member: { id: string; first_name: string; last_name: string } | null;
  coach: { full_name: string } | null;
}

export default async function WorkoutsPage({ searchParams }: { searchParams: Promise<{ member?: string }> }) {
  const sp = await searchParams;
  const ctx = await requirePagePermission("workouts.manage_all", "workouts.manage_assigned");
  const db = ctx.supabase;
  const memberFilter = sp.member && /^[0-9a-f-]{36}$/.test(sp.member) ? sp.member : undefined;

  let query = db
    .from("workout_programs")
    .select("id, name, status, start_date, end_date, member:members(id, first_name, last_name), coach:coaches(full_name)")
    .eq("organization_id", ctx.org.id)
    .order("created_at", { ascending: false })
    .limit(200);
  if (memberFilter) query = query.eq("member_id", memberFilter);

  // Les listes de choix respectent la RLS : un coach ne voit que ses membres.
  const [{ data }, { data: members }, { data: coaches }] = await Promise.all([
    query,
    db.from("members").select("id, first_name, last_name, member_code").eq("organization_id", ctx.org.id).is("archived_at", null).order("last_name").limit(1000),
    ctx.can("workouts.manage_all") ? db.from("coaches").select("id, full_name").eq("organization_id", ctx.org.id).eq("is_active", true).order("full_name") : Promise.resolve({ data: null }),
  ]);
  const programs = (data ?? []) as unknown as ProgramListRow[];
  const memberOptions = (members ?? []).map((m) => ({ id: m.id as string, label: `${m.first_name} ${m.last_name} (${m.member_code})` }));
  const coachOptions = coaches ? coaches.map((c) => ({ id: c.id as string, label: c.full_name as string })) : undefined;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Programmes d'entraînement"
        description={ctx.can("workouts.manage_all") ? "Tous les programmes de la salle." : "Les programmes de vos membres et vos modèles."}
        actions={
          <ProgramDialog
            trigger={<Button><Plus aria-hidden /> Nouveau programme</Button>}
            members={memberOptions}
            coaches={coachOptions}
            defaultMemberId={memberFilter}
          />
        }
      />
      {programs.length === 0 ? (
        <EmptyState icon={ClipboardList} title="Aucun programme" description="Créez un programme pour un membre ou un modèle réutilisable." />
      ) : (
        <Table>
          <THead>
            <tr><Th>Programme</Th><Th>Membre</Th><Th>Coach</Th><Th>Période</Th><Th>Statut</Th></tr>
          </THead>
          <TBody>
            {programs.map((p) => (
              <Tr key={p.id}>
                <Td><Link href={`/workouts/${p.id}`} className="font-medium hover:underline">{p.name}</Link></Td>
                <Td>{p.member ? `${p.member.first_name} ${p.member.last_name}` : <span className="text-muted-foreground">Modèle</span>}</Td>
                <Td>{p.coach?.full_name ?? "—"}</Td>
                <Td className="whitespace-nowrap">{p.start_date ? `${formatDate(p.start_date)} → ${formatDate(p.end_date)}` : "—"}</Td>
                <Td><Badge variant={p.status === "active" ? "success" : "outline"}>{t.programStatus[p.status]}</Badge></Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
