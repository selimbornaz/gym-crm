"use client";

import { ActionDialog } from "@/components/app/action-dialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { isoToTunisLocal } from "@/lib/format";
import { checkOut, correctAttendance } from "./actions";

/** Enregistre la sortie d'un membre (confirmation légère). */
export function ActionDialogButton({ attendanceId }: { attendanceId: string }) {
  return (
    <ActionDialog trigger={<Button size="sm" variant="ghost">Sortie</Button>} title="Enregistrer la sortie ?" action={checkOut} submitLabel="Confirmer">
      {() => <input type="hidden" name="attendance_id" value={attendanceId} />}
    </ActionDialog>
  );
}

export function CorrectAttendanceDialog({ row }: { row: { id: string; checked_in_at: string; checked_out_at: string | null } }) {
  return (
    <ActionDialog
      trigger={<Button size="sm" variant="ghost">Corriger</Button>}
      title="Corriger le passage"
      description="La correction et son motif sont enregistrés dans le journal d'audit."
      action={correctAttendance}
    >
      {(state) => (
        <>
          <input type="hidden" name="attendance_id" value={row.id} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Entrée" htmlFor={`in-${row.id}`} error={state.fieldErrors?.checked_in_at}>
              <Input id={`in-${row.id}`} name="checked_in_at" type="datetime-local" defaultValue={isoToTunisLocal(row.checked_in_at)} />
            </Field>
            <Field label="Sortie" htmlFor={`out-${row.id}`} error={state.fieldErrors?.checked_out_at}>
              <Input id={`out-${row.id}`} name="checked_out_at" type="datetime-local" defaultValue={row.checked_out_at ? isoToTunisLocal(row.checked_out_at) : ""} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="void" className="size-4" /> Annuler ce passage (saisie erronée)
          </label>
          <Field label="Motif" htmlFor={`reason-${row.id}`} error={state.fieldErrors?.reason} required>
            <Textarea id={`reason-${row.id}`} name="reason" rows={2} />
          </Field>
        </>
      )}
    </ActionDialog>
  );
}
