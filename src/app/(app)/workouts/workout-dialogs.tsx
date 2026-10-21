"use client";

import type { ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { ActionDialog } from "@/components/app/action-dialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { todayInTunis } from "@/lib/format";
import { t } from "@/i18n";
import { addExercise, addProgress, addWorkoutDay, deleteWorkoutItem, logWorkout, saveProgram } from "./actions";

type Option = { id: string; label: string };

export interface ProgramValues {
  id: string;
  name: string;
  member_id: string | null;
  coach_id: string | null;
  goal: string | null;
  start_date: string | null;
  end_date: string | null;
  status: keyof typeof t.programStatus;
  notes: string | null;
}

export function ProgramDialog({
  trigger,
  program,
  members,
  coaches,
  defaultMemberId,
}: {
  trigger: ReactNode;
  program?: ProgramValues;
  members: Option[];
  coaches?: Option[];
  defaultMemberId?: string;
}) {
  return (
    <ActionDialog trigger={trigger} title={program ? "Modifier le programme" : "Nouveau programme"} action={saveProgram} wide>
      {(state) => {
        const e = state.fieldErrors ?? {};
        return (
          <>
            {program && <input type="hidden" name="program_id" value={program.id} />}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nom" htmlFor="program_name" error={e.name} required>
                <Input id="program_name" name="name" defaultValue={program?.name} placeholder="Ex. Prise de masse – 8 semaines" />
              </Field>
              <Field label="Membre" htmlFor="program_member" error={e.member_id} hint="Vide = modèle réutilisable">
                <NativeSelect id="program_member" name="member_id" defaultValue={program?.member_id ?? defaultMemberId ?? ""}>
                  <option value="">Aucun (modèle)</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </NativeSelect>
              </Field>
              {coaches && (
                <Field label="Coach" htmlFor="program_coach" error={e.coach_id}>
                  <NativeSelect id="program_coach" name="coach_id" defaultValue={program?.coach_id ?? ""}>
                    <option value="">Aucun</option>
                    {coaches.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </NativeSelect>
                </Field>
              )}
              <Field label="Statut" htmlFor="program_status" error={e.status}>
                <NativeSelect id="program_status" name="status" defaultValue={program?.status ?? "draft"}>
                  {(Object.keys(t.programStatus) as Array<keyof typeof t.programStatus>).map((s) => <option key={s} value={s}>{t.programStatus[s]}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Début" htmlFor="program_start" error={e.start_date}>
                <Input id="program_start" name="start_date" type="date" defaultValue={program?.start_date ?? ""} />
              </Field>
              <Field label="Fin" htmlFor="program_end" error={e.end_date}>
                <Input id="program_end" name="end_date" type="date" defaultValue={program?.end_date ?? ""} />
              </Field>
            </div>
            <Field label="Objectif" htmlFor="program_goal" error={e.goal}>
              <Input id="program_goal" name="goal" defaultValue={program?.goal ?? ""} />
            </Field>
            <Field label="Notes" htmlFor="program_notes" error={e.notes}>
              <Textarea id="program_notes" name="notes" rows={2} defaultValue={program?.notes ?? ""} />
            </Field>
          </>
        );
      }}
    </ActionDialog>
  );
}

export function DayDialog({ programId, nextDay }: { programId: string; nextDay: number }) {
  return (
    <ActionDialog trigger={<Button variant="outline">Ajouter un jour</Button>} title="Nouveau jour d'entraînement" action={addWorkoutDay}>
      {(state) => (
        <>
          <input type="hidden" name="program_id" value={programId} />
          <div className="grid gap-4 sm:grid-cols-[6rem_1fr]">
            <Field label="Jour n°" htmlFor="day_number" error={state.fieldErrors?.day_number}>
              <Input id="day_number" name="day_number" type="number" min={1} max={14} defaultValue={nextDay} />
            </Field>
            <Field label="Titre" htmlFor="day_title" error={state.fieldErrors?.title} required>
              <Input id="day_title" name="title" placeholder="Ex. Haut du corps" />
            </Field>
          </div>
          <Field label="Groupe musculaire" htmlFor="muscle_group" error={state.fieldErrors?.muscle_group}>
            <Input id="muscle_group" name="muscle_group" placeholder="Ex. Pectoraux, triceps" />
          </Field>
        </>
      )}
    </ActionDialog>
  );
}

export function ExerciseDialog({ programId, dayId }: { programId: string; dayId: string }) {
  return (
    <ActionDialog trigger={<Button size="sm" variant="ghost">+ Exercice</Button>} title="Ajouter un exercice" action={addExercise}>
      {(state) => {
        const e = state.fieldErrors ?? {};
        return (
          <>
            <input type="hidden" name="program_id" value={programId} />
            <input type="hidden" name="day_id" value={dayId} />
            <Field label="Exercice" htmlFor="ex_name" error={e.name} required>
              <Input id="ex_name" name="name" placeholder="Ex. Développé couché" />
            </Field>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Field label="Séries" htmlFor="ex_sets" error={e.sets}><Input id="ex_sets" name="sets" type="number" min={1} defaultValue={3} /></Field>
              <Field label="Répétitions" htmlFor="ex_reps" error={e.reps}><Input id="ex_reps" name="reps" placeholder="8-12" /></Field>
              <Field label="Repos (s)" htmlFor="ex_rest" error={e.rest_seconds}><Input id="ex_rest" name="rest_seconds" type="number" min={0} defaultValue={90} /></Field>
              <Field label="Charge" htmlFor="ex_load" error={e.load}><Input id="ex_load" name="load" placeholder="40 kg" /></Field>
            </div>
            <Field label="Consignes" htmlFor="ex_instructions" error={e.instructions}>
              <Textarea id="ex_instructions" name="instructions" rows={2} />
            </Field>
          </>
        );
      }}
    </ActionDialog>
  );
}

export function DeleteItemButton({ programId, target, id, label }: { programId: string; target: "day" | "exercise" | "log"; id: string; label: string }) {
  return (
    <ActionDialog
      trigger={<Button size="icon" variant="ghost" aria-label={`Supprimer ${label}`}><Trash2 /></Button>}
      title={`Supprimer ${label} ?`}
      description={target === "day" ? "Les exercices de ce jour seront aussi supprimés." : undefined}
      action={deleteWorkoutItem}
      submitLabel="Supprimer"
      destructive
    >
      {() => (
        <>
          <input type="hidden" name="program_id" value={programId} />
          <input type="hidden" name="target" value={target} />
          <input type="hidden" name="id" value={id} />
        </>
      )}
    </ActionDialog>
  );
}

export function LogWorkoutDialog({ programId, memberId, days }: { programId: string; memberId: string; days: Option[] }) {
  return (
    <ActionDialog trigger={<Button variant="outline">Enregistrer une séance</Button>} title="Séance réalisée" action={logWorkout}>
      {(state) => (
        <>
          <input type="hidden" name="program_id" value={programId} />
          <input type="hidden" name="member_id" value={memberId} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date" htmlFor="performed_on" error={state.fieldErrors?.performed_on}>
              <Input id="performed_on" name="performed_on" type="date" defaultValue={todayInTunis()} max={todayInTunis()} />
            </Field>
            <Field label="Jour du programme" htmlFor="log_day">
              <NativeSelect id="log_day" name="day_id" defaultValue="">
                <option value="">—</option>
                {days.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </NativeSelect>
            </Field>
          </div>
          <Field label="Réalisation" htmlFor="completed">
            <NativeSelect id="completed" name="completed" defaultValue="true">
              <option value="true">Séance complète</option>
              <option value="false">Séance partielle / interrompue</option>
            </NativeSelect>
          </Field>
          <Field label="Notes" htmlFor="log_notes"><Textarea id="log_notes" name="notes" rows={2} /></Field>
        </>
      )}
    </ActionDialog>
  );
}

export function ProgressDialog({ memberId, programId }: { memberId: string; programId?: string }) {
  return (
    <ActionDialog
      trigger={<Button variant="outline">Ajouter des mesures</Button>}
      title="Mesures de progression"
      description="Données sensibles : visibles uniquement par le propriétaire et le coach assigné."
      action={addProgress}
      wide
    >
      {(state) => {
        const e = state.fieldErrors ?? {};
        return (
          <>
            <input type="hidden" name="member_id" value={memberId} />
            {programId && <input type="hidden" name="program_id" value={programId} />}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Field label="Date" htmlFor="recorded_on" error={e.recorded_on}><Input id="recorded_on" name="recorded_on" type="date" defaultValue={todayInTunis()} /></Field>
              <Field label="Poids (kg)" htmlFor="weight_kg" error={e.weight_kg}><Input id="weight_kg" name="weight_kg" inputMode="decimal" /></Field>
              <Field label="Masse grasse (%)" htmlFor="body_fat_pct" error={e.body_fat_pct}><Input id="body_fat_pct" name="body_fat_pct" inputMode="decimal" /></Field>
              <Field label="Tour de taille (cm)" htmlFor="waist_cm" error={e.waist_cm}><Input id="waist_cm" name="waist_cm" inputMode="decimal" /></Field>
              <Field label="Tour de poitrine (cm)" htmlFor="chest_cm" error={e.chest_cm}><Input id="chest_cm" name="chest_cm" inputMode="decimal" /></Field>
              <Field label="Tour de bras (cm)" htmlFor="arm_cm" error={e.arm_cm}><Input id="arm_cm" name="arm_cm" inputMode="decimal" /></Field>
            </div>
            <Field label="Notes de progression" htmlFor="progress_notes" error={e.notes}>
              <Textarea id="progress_notes" name="notes" rows={2} />
            </Field>
          </>
        );
      }}
    </ActionDialog>
  );
}
