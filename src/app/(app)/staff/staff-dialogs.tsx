"use client";

import { useState, type ReactNode } from "react";
import { Eye, EyeOff, KeyRound, Wand2 } from "lucide-react";
import { ActionDialog } from "@/components/app/action-dialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { t } from "@/i18n";
import type { StaffRole } from "@/lib/permissions";
import { createStaff, resetStaffPassword, setStaffActive, updateStaffRole } from "./actions";

const ROLES: StaffRole[] = ["receptionist", "coach", "owner"];

/** Mot de passe aléatoire lisible (sans caractères ambigus), avec lettres et chiffres. */
function generatePassword(): string {
  const letters = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const all = letters + digits;
  const bytes = crypto.getRandomValues(new Uint32Array(12));
  const chars = Array.from(bytes, (b) => all[b % all.length]!);
  chars[0] = letters[bytes[0]! % letters.length]!;
  chars[11] = digits[bytes[11]! % digits.length]!;
  return chars.join("");
}

/** Mot de passe + confirmation, avec affichage et génération automatique. */
function PasswordFields({ idPrefix, errors }: { idPrefix: string; errors?: Record<string, string> }) {
  const [value, setValue] = useState("");
  const [confirm, setConfirm] = useState("");
  const [visible, setVisible] = useState(false);
  return (
    <>
      <Field label="Mot de passe" htmlFor={`${idPrefix}-password`} error={errors?.password} required hint="8 caractères minimum, avec au moins une lettre et un chiffre.">
        <div className="flex gap-2">
          <Input
            id={`${idPrefix}-password`}
            name="password"
            type={visible ? "text" : "password"}
            autoComplete="new-password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="font-mono"
          />
          <Button type="button" variant="outline" size="icon" onClick={() => setVisible((v) => !v)} aria-label={visible ? "Masquer le mot de passe" : "Afficher le mot de passe"}>
            {visible ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const p = generatePassword();
              setValue(p);
              setConfirm(p);
              setVisible(true);
            }}
          >
            <Wand2 aria-hidden /> Générer
          </Button>
        </div>
      </Field>
      <Field label="Confirmer le mot de passe" htmlFor={`${idPrefix}-password-confirm`} error={errors?.password_confirm} required>
        <Input
          id={`${idPrefix}-password-confirm`}
          name="password_confirm"
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="font-mono"
        />
      </Field>
    </>
  );
}

export function CreateStaffDialog({ trigger }: { trigger: ReactNode }) {
  return (
    <ActionDialog
      trigger={trigger}
      title="Ajouter un employé"
      description="Choisissez son email et son mot de passe : il pourra se connecter tout de suite, sans email d'invitation."
      action={createStaff}
      submitLabel="Créer le compte"
    >
      {(state) => (
        <>
          <Field label="Nom complet" htmlFor="full_name" error={state.fieldErrors?.full_name} required>
            <Input id="full_name" name="full_name" autoComplete="off" />
          </Field>
          <Field label="Email (identifiant de connexion)" htmlFor="email" error={state.fieldErrors?.email} required>
            <Input id="email" name="email" type="email" autoComplete="off" />
          </Field>
          <PasswordFields idPrefix="new-staff" errors={state.fieldErrors} />
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
      {role !== "owner" && (
        <ActionDialog
          trigger={
            <Button variant="outline" size="sm">
              <KeyRound aria-hidden /> Mot de passe
            </Button>
          }
          title={`Nouveau mot de passe pour ${name}`}
          description="À utiliser si l'employé a oublié son mot de passe. Communiquez-lui le nouveau de vive voix."
          action={resetStaffPassword}
          submitLabel="Changer le mot de passe"
        >
          {(state) => (
            <>
              <input type="hidden" name="staff_id" value={staffId} />
              <PasswordFields idPrefix={`pw-${staffId}`} errors={state.fieldErrors} />
            </>
          )}
        </ActionDialog>
      )}
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
