"use client";

import type { ReactNode } from "react";
import { ActionDialog } from "@/components/app/action-dialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { t } from "@/i18n";
import type { StaffRole } from "@/lib/permissions";
import { inviteStaff, setStaffActive, updateStaffRole } from "./actions";

const ROLES: StaffRole[] = ["receptionist", "coach", "owner"];

export function InviteStaffDialog({ trigger }: { trigger: ReactNode }) {
  return (
    <ActionDialog
      trigger={trigger}
      title="Inviter un employé"
      description="La personne reçoit un email pour choisir son mot de passe."
      action={inviteStaff}
      submitLabel="Envoyer l'invitation"
    >
      {(state) => (
        <>
          <Field label="Nom complet" htmlFor="full_name" error={state.fieldErrors?.full_name} required>
            <Input id="full_name" name="full_name" autoComplete="off" />
          </Field>
          <Field label="Email" htmlFor="email" error={state.fieldErrors?.email} required>
            <Input id="email" name="email" type="email" autoComplete="off" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Rôle" htmlFor="role" error={state.fieldErrors?.role} required>
              <NativeSelect id="role" name="role" defaultValue="receptionist">
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t.roles[r]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Poste (optionnel)" htmlFor="job_title">
              <Input id="job_title" name="job_title" placeholder="Ex. Responsable accueil" />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="create_coach" defaultChecked className="size-4" />
            Si coach : créer aussi sa fiche coach
          </label>
        </>
      )}
    </ActionDialog>
  );
}

export function StaffActions({
  staffId,
  name,
  role,
  jobTitle,
  active,
}: {
  staffId: string;
  name: string;
  role: StaffRole;
  jobTitle: string | null;
  active: boolean;
}) {
  return (
    <div className="flex justify-end gap-2">
      <ActionDialog
        trigger={
          <Button variant="outline" size="sm">
            Rôle
          </Button>
        }
        title={`Modifier le rôle de ${name}`}
        description="Le nouveau rôle s'applique immédiatement à toutes les sessions."
        action={updateStaffRole}
      >
        {(state) => (
          <>
            <input type="hidden" name="staff_id" value={staffId} />
            <Field label="Rôle" htmlFor={`role-${staffId}`} error={state.fieldErrors?.role}>
              <NativeSelect id={`role-${staffId}`} name="role" defaultValue={role}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t.roles[r]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Poste" htmlFor={`job-${staffId}`}>
              <Input id={`job-${staffId}`} name="job_title" defaultValue={jobTitle ?? ""} />
            </Field>
          </>
        )}
      </ActionDialog>
      <ActionDialog
        trigger={
          <Button variant={active ? "ghost" : "secondary"} size="sm">
            {active ? "Désactiver" : "Réactiver"}
          </Button>
        }
        title={active ? `Désactiver ${name} ?` : `Réactiver ${name} ?`}
        description={
          active
            ? "Son accès est coupé immédiatement. L'historique de ses actions est conservé."
            : "La personne retrouve l'accès avec son rôle actuel."
        }
        action={setStaffActive}
        submitLabel={active ? "Désactiver" : "Réactiver"}
        destructive={active}
      >
        {() => (
          <>
            <input type="hidden" name="staff_id" value={staffId} />
            <input type="hidden" name="active" value={active ? "false" : "true"} />
          </>
        )}
      </ActionDialog>
    </div>
  );
}
