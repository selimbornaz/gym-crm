import type { Metadata } from "next";
import { UserPlus } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { requirePagePermission } from "@/lib/auth/context";
import { formatDate } from "@/lib/format";
import { t } from "@/i18n";
import type { StaffRole } from "@/lib/permissions";
import { InviteStaffDialog, StaffActions } from "./staff-dialogs";

export const metadata: Metadata = { title: "Employés" };

interface StaffRow {
  id: string;
  role: StaffRole;
  is_active: boolean;
  job_title: string | null;
  created_at: string;
  user_id: string;
  profile: { full_name: string; email: string | null } | null;
}

export default async function StaffPage() {
  const ctx = await requirePagePermission("staff.manage");
  const { data } = await ctx.supabase
    .from("staff")
    .select("id, role, is_active, job_title, created_at, user_id, profile:profiles(full_name, email)")
    .eq("organization_id", ctx.org.id)
    .order("is_active", { ascending: false })
    .order("created_at");
  const staff = (data ?? []) as unknown as StaffRow[];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Employés"
        description="Comptes, rôles et accès du personnel. Les changements sont journalisés."
        actions={
          <InviteStaffDialog
            trigger={
              <Button>
                <UserPlus aria-hidden /> Inviter un employé
              </Button>
            }
          />
        }
      />

      <div className="grid gap-3 rounded-xl border bg-card p-4 text-sm sm:grid-cols-3">
        <p><span className="font-medium">{t.roles.owner}</span> — accès complet, finances, paramètres, personnel.</p>
        <p><span className="font-medium">{t.roles.receptionist}</span> — membres, abonnements, encaissements, présences.</p>
        <p><span className="font-medium">{t.roles.coach}</span> — membres assignés, programmes, progression, planning.</p>
      </div>

      <Table>
        <THead>
          <tr>
            <Th>Nom</Th>
            <Th>Rôle</Th>
            <Th>Statut</Th>
            <Th>Depuis</Th>
            <Th className="text-right">{t.common.actions}</Th>
          </tr>
        </THead>
        <TBody>
          {staff.map((s) => {
            const self = s.user_id === ctx.user.id;
            return (
              <Tr key={s.id}>
                <Td>
                  <p className="font-medium">
                    {s.profile?.full_name || "—"} {self && <span className="text-xs text-muted-foreground">(vous)</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">{s.profile?.email}</p>
                  {s.job_title && <p className="text-xs text-muted-foreground">{s.job_title}</p>}
                </Td>
                <Td>
                  <Badge variant="outline">{t.roles[s.role]}</Badge>
                </Td>
                <Td>{s.is_active ? <Badge variant="success">Actif</Badge> : <Badge variant="secondary">Désactivé</Badge>}</Td>
                <Td className="whitespace-nowrap">{formatDate(s.created_at)}</Td>
                <Td className="text-right">
                  {self ? (
                    <span className="text-xs text-muted-foreground">Non modifiable</span>
                  ) : (
                    <StaffActions staffId={s.id} name={s.profile?.full_name ?? ""} role={s.role} jobTitle={s.job_title} active={s.is_active} />
                  )}
                </Td>
              </Tr>
            );
          })}
        </TBody>
      </Table>
    </div>
  );
}
