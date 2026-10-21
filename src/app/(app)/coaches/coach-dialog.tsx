"use client";

import { Pencil, Plus } from "lucide-react";
import { ActionDialog } from "@/components/app/action-dialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { CoachRow } from "@/lib/types";
import { t } from "@/i18n";
import { saveCoach } from "./actions";

export function CoachDialog({ coach }: { coach?: CoachRow }) {
  const slotsFor = (day: number) =>
    (coach?.availability ?? []).filter((s) => s.day === day).map((s) => `${s.start}-${s.end}`).join(", ");

  return (
    <ActionDialog
      trigger={coach ? <Button size="icon" variant="ghost" aria-label={`Modifier ${coach.full_name}`}><Pencil /></Button> : <Button><Plus aria-hidden /> Nouveau coach</Button>}
      title={coach ? `Modifier ${coach.full_name}` : "Nouveau coach"}
      description="Pour donner un accès à l'application, invitez la personne depuis « Employés » avec le rôle Coach."
      action={saveCoach}
      wide
    >
      {(state) => {
        const e = state.fieldErrors ?? {};
        return (
          <>
            {coach && <input type="hidden" name="coach_id" value={coach.id} />}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nom complet" htmlFor="coach_name" error={e.full_name} required>
                <Input id="coach_name" name="full_name" defaultValue={coach?.full_name} />
              </Field>
              <Field label="Spécialités" htmlFor="specialties" error={e.specialties} hint="Séparées par des virgules">
                <Input id="specialties" name="specialties" defaultValue={coach?.specialties.join(", ")} placeholder="CrossFit, Yoga" />
              </Field>
              <Field label="Téléphone" htmlFor="coach_phone" error={e.phone}>
                <Input id="coach_phone" name="phone" defaultValue={coach?.phone ?? ""} />
              </Field>
              <Field label="Email" htmlFor="coach_email" error={e.email}>
                <Input id="coach_email" name="email" type="email" defaultValue={coach?.email ?? ""} />
              </Field>
            </div>
            <Field label="Présentation" htmlFor="bio" error={e.bio}>
              <Textarea id="bio" name="bio" rows={2} defaultValue={coach?.bio ?? ""} />
            </Field>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Disponibilités hebdomadaires</legend>
              <p className="text-xs text-muted-foreground">Format : 08:00-12:00, 17:00-21:00 — laisser vide si indisponible.</p>
              {t.weekdays.map((label, i) => (
                <div key={label} className="grid grid-cols-[6rem_1fr] items-center gap-2">
                  <label htmlFor={`avail_${i + 1}`} className="text-sm">{label}</label>
                  <Input id={`avail_${i + 1}`} name={`avail_${i + 1}`} defaultValue={slotsFor(i + 1)} className="font-mono text-xs" />
                </div>
              ))}
              {e.availability && <p className="text-xs text-danger">{e.availability}</p>}
            </fieldset>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="is_active" defaultChecked={coach?.is_active ?? true} className="size-4" /> Coach actif
            </label>
          </>
        );
      }}
    </ActionDialog>
  );
}
