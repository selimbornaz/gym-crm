import type { Metadata } from "next";
import { ScrollText } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Pagination, pageRange } from "@/components/app/pagination";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { requirePagePermission } from "@/lib/auth/context";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Journal d'audit" };

const ENTITIES: Record<string, string> = {
  payments: "Paiements",
  payment_adjustments: "Remboursements",
  subscriptions: "Abonnements",
  attendance: "Présences",
  staff: "Personnel",
  membership_plans: "Formules",
  expenses: "Dépenses",
  organizations: "Salle",
  members: "Membres",
};

const ACTION_LABEL: Record<string, string> = {
  insert: "Création", update: "Modification", delete: "Suppression", invite: "Invitation", override: "Dérogation", export: "Export",
};

/** Résumé lisible des champs modifiés (sans afficher d'objet brut). */
function diffSummary(before: Record<string, unknown> | null, after: Record<string, unknown> | null): string {
  if (!before || !after) return "";
  const ignored = new Set(["updated_at", "created_at"]);
  return Object.keys(after)
    .filter((k) => !ignored.has(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .slice(0, 6)
    .map((k) => `${k} : ${String(before[k] ?? "—")} → ${String(after[k] ?? "—")}`)
    .join(" · ");
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ entity?: string; page?: string }> }) {
  const sp = await searchParams;
  const ctx = await requirePagePermission("audit.read");
  const { page, from, to } = pageRange(sp.page, 50);

  let query = ctx.supabase
    .from("audit_logs")
    .select("id, action, entity_type, entity_id, reason, before_data, after_data, created_at, actor_user_id", { count: "exact" })
    .eq("organization_id", ctx.org.id);
  if (sp.entity && sp.entity in ENTITIES) query = query.eq("entity_type", sp.entity);

  const [{ data, count }, { data: staff }] = await Promise.all([
    query.order("created_at", { ascending: false }).range(from, to),
    ctx.supabase.from("staff").select("user_id, profile:profiles(full_name)").eq("organization_id", ctx.org.id),
  ]);
  const names = new Map(((staff ?? []) as unknown as Array<{ user_id: string; profile: { full_name: string } | null }>).map((s) => [s.user_id, s.profile?.full_name ?? ""]));
  const rows = (data ?? []) as Array<{ id: number; action: string; entity_type: string; entity_id: string | null; reason: string | null; before_data: Record<string, unknown> | null; after_data: Record<string, unknown> | null; created_at: string; actor_user_id: string | null }>;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Journal d'audit" description="Actions sensibles : finances, abonnements, présences, personnel, paramètres. Lecture seule, non modifiable." />
      <form method="get" className="flex flex-wrap items-center gap-2">
        <NativeSelect name="entity" defaultValue={sp.entity ?? ""} aria-label="Type" className="w-auto bg-card">
          <option value="">Tous les types</option>
          {Object.entries(ENTITIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </NativeSelect>
        <Button type="submit" variant="secondary">Filtrer</Button>
      </form>

      {rows.length === 0 ? (
        <EmptyState icon={ScrollText} title="Aucune entrée" />
      ) : (
        <>
          <Table>
            <THead><tr><Th>Date</Th><Th>Auteur</Th><Th>Action</Th><Th>Détail</Th><Th>Motif</Th></tr></THead>
            <TBody>
              {rows.map((r) => {
                const verb = r.action.split(".").at(-1) ?? r.action;
                return (
                  <Tr key={r.id}>
                    <Td className="whitespace-nowrap text-xs">{formatDateTime(r.created_at)}</Td>
                    <Td>{r.actor_user_id ? names.get(r.actor_user_id) || "Utilisateur" : "Système"}</Td>
                    <Td className="whitespace-nowrap">{ENTITIES[r.entity_type] ?? r.entity_type} — {ACTION_LABEL[verb] ?? verb}</Td>
                    <Td className="max-w-md text-xs text-muted-foreground">{diffSummary(r.before_data, r.after_data) || (r.entity_id ? `#${r.entity_id.slice(0, 8)}` : "")}</Td>
                    <Td className="text-xs">{r.reason ?? "—"}</Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
          <Pagination page={page} total={count ?? 0} size={50} searchParams={sp} />
        </>
      )}
    </div>
  );
}
