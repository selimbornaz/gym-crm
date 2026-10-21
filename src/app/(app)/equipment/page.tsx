import type { Metadata } from "next";
import { Wrench } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { requirePagePermission } from "@/lib/auth/context";
import { addDaysIso, formatDate, formatMoney, todayInTunis } from "@/lib/format";
import { t } from "@/i18n";
import { ArchiveEquipmentDialog, EquipmentDialog, MaintenanceDialog, type EquipmentValues } from "./equipment-dialogs";

export const metadata: Metadata = { title: "Équipements" };

const CONDITION: Record<EquipmentValues["condition"], BadgeVariant> = {
  new: "success", good: "success", fair: "warning", poor: "danger", out_of_service: "secondary",
};

export default async function EquipmentPage() {
  const ctx = await requirePagePermission("equipment.read");
  const { data } = await ctx.supabase
    .from("equipment")
    .select("*, equipment_maintenance(id, performed_on, description, cost, performed_by)")
    .eq("organization_id", ctx.org.id)
    .is("archived_at", null)
    .order("next_maintenance_on", { ascending: true, nullsFirst: false })
    .order("name");
  const items = (data ?? []) as Array<EquipmentValues & { equipment_maintenance: Array<{ id: string; performed_on: string; description: string; cost: number | null; performed_by: string | null }> }>;
  const today = todayInTunis();
  const soon = addDaysIso(today, 7);
  const due = items.filter((i) => i.next_maintenance_on && i.next_maintenance_on <= soon);
  const canManage = ctx.can("equipment.manage");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Équipements" description="Inventaire, état et maintenance." actions={canManage && <EquipmentDialog />} />

      {due.length > 0 && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
          <p className="font-medium text-warning">{due.length} équipement{due.length > 1 ? "s" : ""} à entretenir sous 7 jours</p>
          <ul className="mt-1 list-inside list-disc">
            {due.map((d) => <li key={d.id}>{d.name} — {formatDate(d.next_maintenance_on)}{d.next_maintenance_on! < today && " (en retard)"}</li>)}
          </ul>
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState icon={Wrench} title="Inventaire vide" description="Ajoutez vos machines et accessoires pour suivre leur entretien." />
      ) : (
        <Table>
          <THead><tr><Th>Équipement</Th><Th>Qté</Th><Th>État</Th><Th>Achat</Th><Th>Dernière maintenance</Th><Th>Prochaine</Th><Th /></tr></THead>
          <TBody>
            {items.map((i) => {
              const last = [...i.equipment_maintenance].sort((a, b) => b.performed_on.localeCompare(a.performed_on))[0];
              const late = i.next_maintenance_on && i.next_maintenance_on < today;
              return (
                <Tr key={i.id}>
                  <Td>
                    <p className="font-medium">{i.name}</p>
                    <p className="text-xs text-muted-foreground">{i.category}{i.location && ` · ${i.location}`}</p>
                  </Td>
                  <Td className="tabular-nums">{i.quantity}</Td>
                  <Td><Badge variant={CONDITION[i.condition]}>{t.equipmentCondition[i.condition]}</Badge></Td>
                  <Td className="whitespace-nowrap text-sm">{formatDate(i.purchase_date)}{i.purchase_cost !== null && <span className="block text-xs text-muted-foreground">{formatMoney(i.purchase_cost)}</span>}</Td>
                  <Td className="text-sm">{last ? <>{formatDate(last.performed_on)}<span className="block text-xs text-muted-foreground">{last.description}</span></> : "—"}</Td>
                  <Td className={`whitespace-nowrap ${late ? "font-medium text-danger" : ""}`}>{formatDate(i.next_maintenance_on)}</Td>
                  <Td className="text-right">
                    {canManage && (
                      <div className="flex justify-end gap-1">
                        <MaintenanceDialog equipmentId={i.id} name={i.name} />
                        <EquipmentDialog equipment={i} />
                        <ArchiveEquipmentDialog equipmentId={i.id} name={i.name} />
                      </div>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      )}
    </div>
  );
}
