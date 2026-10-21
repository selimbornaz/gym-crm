"use client";

import { Plus } from "lucide-react";
import { ActionDialog } from "@/components/app/action-dialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { todayInTunis } from "@/lib/format";
import { t } from "@/i18n";
import { archiveEquipment, logMaintenance, saveEquipment } from "./actions";

export interface EquipmentValues {
  id: string;
  name: string;
  category: string;
  quantity: number;
  purchase_date: string | null;
  purchase_cost: number | null;
  condition: keyof typeof t.equipmentCondition;
  location: string | null;
  next_maintenance_on: string | null;
  notes: string | null;
}

export function EquipmentDialog({ equipment }: { equipment?: EquipmentValues }) {
  return (
    <ActionDialog
      trigger={equipment ? <Button size="sm" variant="ghost">Modifier</Button> : <Button><Plus aria-hidden /> Nouvel équipement</Button>}
      title={equipment ? `Modifier ${equipment.name}` : "Nouvel équipement"}
      action={saveEquipment}
      wide
    >
      {(state) => {
        const e = state.fieldErrors ?? {};
        return (
          <>
            {equipment && <input type="hidden" name="equipment_id" value={equipment.id} />}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nom" htmlFor="eq_name" error={e.name} required><Input id="eq_name" name="name" defaultValue={equipment?.name} placeholder="Ex. Tapis de course Technogym" /></Field>
              <Field label="Catégorie" htmlFor="eq_category" error={e.category} required><Input id="eq_category" name="category" defaultValue={equipment?.category ?? "Cardio"} /></Field>
              <Field label="Quantité" htmlFor="quantity" error={e.quantity}><Input id="quantity" name="quantity" type="number" min={0} defaultValue={equipment?.quantity ?? 1} /></Field>
              <Field label="État" htmlFor="condition" error={e.condition}>
                <NativeSelect id="condition" name="condition" defaultValue={equipment?.condition ?? "good"}>
                  {Object.entries(t.equipmentCondition).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Date d'achat" htmlFor="purchase_date" error={e.purchase_date}><Input id="purchase_date" name="purchase_date" type="date" defaultValue={equipment?.purchase_date ?? ""} /></Field>
              <Field label="Coût d'achat (TND)" htmlFor="purchase_cost" error={e.purchase_cost}><Input id="purchase_cost" name="purchase_cost" inputMode="decimal" defaultValue={equipment?.purchase_cost?.toString() ?? ""} /></Field>
              <Field label="Emplacement" htmlFor="location" error={e.location}><Input id="location" name="location" defaultValue={equipment?.location ?? ""} /></Field>
              <Field label="Prochaine maintenance" htmlFor="next_maintenance_on" error={e.next_maintenance_on}><Input id="next_maintenance_on" name="next_maintenance_on" type="date" defaultValue={equipment?.next_maintenance_on ?? ""} /></Field>
            </div>
            <Field label="Notes" htmlFor="eq_notes" error={e.notes}><Textarea id="eq_notes" name="notes" rows={2} defaultValue={equipment?.notes ?? ""} /></Field>
          </>
        );
      }}
    </ActionDialog>
  );
}

export function MaintenanceDialog({ equipmentId, name }: { equipmentId: string; name: string }) {
  return (
    <ActionDialog trigger={<Button size="sm" variant="ghost">Maintenance</Button>} title={`Maintenance — ${name}`} action={logMaintenance}>
      {(state) => {
        const e = state.fieldErrors ?? {};
        return (
          <>
            <input type="hidden" name="equipment_id" value={equipmentId} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Date" htmlFor="performed_on" error={e.performed_on} required><Input id="performed_on" name="performed_on" type="date" defaultValue={todayInTunis()} /></Field>
              <Field label="Coût (TND)" htmlFor="m_cost" error={e.cost}><Input id="m_cost" name="cost" inputMode="decimal" /></Field>
              <Field label="Intervenant" htmlFor="performed_by" error={e.performed_by}><Input id="performed_by" name="performed_by" /></Field>
              <Field label="Prochaine échéance" htmlFor="next_due_on" error={e.next_due_on}><Input id="next_due_on" name="next_due_on" type="date" /></Field>
            </div>
            <Field label="Travaux réalisés" htmlFor="m_description" error={e.description} required><Textarea id="m_description" name="description" rows={2} /></Field>
          </>
        );
      }}
    </ActionDialog>
  );
}

export function ArchiveEquipmentDialog({ equipmentId, name }: { equipmentId: string; name: string }) {
  return (
    <ActionDialog
      trigger={<Button size="sm" variant="ghost" className="text-danger">Retirer</Button>}
      title={`Retirer ${name} de l'inventaire ?`}
      description="L'équipement n'apparaît plus dans la liste ; son historique de maintenance est conservé."
      action={archiveEquipment}
      submitLabel="Retirer"
      destructive
    >
      {() => <input type="hidden" name="equipment_id" value={equipmentId} />}
    </ActionDialog>
  );
}
