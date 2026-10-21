import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, CircleDashed, Pencil } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePagePermission } from "@/lib/auth/context";
import { formatDate } from "@/lib/format";
import { t } from "@/i18n";
import {
  DayDialog,
  DeleteItemButton,
  ExerciseDialog,
  LogWorkoutDialog,
  ProgramDialog,
  ProgressDialog,
  type ProgramValues,
} from "../workout-dialogs";

export const metadata: Metadata = { title: "Programme" };

interface Exercise { id: string; name: string; sets: number | null; reps: string | null; rest_seconds: number | null; load: string | null; instructions: string | null; position: number }
interface Day { id: string; day_number: number; title: string; muscle_group: string | null; position: number; workout_exercises: Exercise[] }

export default async function ProgramPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePagePermission("workouts.manage_all", "workouts.manage_assigned", "members.read_all");
  const db = ctx.supabase;

  const { data: programData } = await db
    .from("workout_programs")
    .select("*, member:members(id, first_name, last_name, member_code), coach:coaches(full_name)")
    .eq("organization_id", ctx.org.id)
    .eq("id", id)
    .maybeSingle();
  if (!programData) notFound();
  const program = programData as ProgramValues & {
    member: { id: string; first_name: string; last_name: string; member_code: string } | null;
    coach: { full_name: string } | null;
  };

  const [{ data: dayData }, { data: logs }, { data: members }, { data: coaches }] = await Promise.all([
    db.from("workout_days").select("id, day_number, title, muscle_group, position, workout_exercises(id, name, sets, reps, rest_seconds, load, instructions, position)")
      .eq("organization_id", ctx.org.id).eq("program_id", id).order("position"),
    db.from("workout_logs").select("id, performed_on, completed, notes, day_id").eq("organization_id", ctx.org.id).eq("program_id", id).order("performed_on", { ascending: false }).limit(30),
    db.from("members").select("id, first_name, last_name, member_code").eq("organization_id", ctx.org.id).is("archived_at", null).order("last_name").limit(1000),
    ctx.can("workouts.manage_all") ? db.from("coaches").select("id, full_name").eq("organization_id", ctx.org.id).eq("is_active", true) : Promise.resolve({ data: null }),
  ]);
  const days = ((dayData ?? []) as Day[]).map((d) => ({ ...d, workout_exercises: [...d.workout_exercises].sort((a, b) => a.position - b.position) }));
  // Le droit d'écriture réel est vérifié par la RLS ; ici on masque seulement les boutons.
  const canEdit = ctx.can("workouts.manage_all", "workouts.manage_assigned");
  const dayLabel = new Map(days.map((d) => [d.id, `Jour ${d.day_number} – ${d.title}`]));
  const completedCount = (logs ?? []).filter((l) => l.completed).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={program.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={program.status === "active" ? "success" : "outline"}>{t.programStatus[program.status]}</Badge>
            {program.member ? (
              <Link href={`/members/${program.member.id}`} className="hover:underline">
                {program.member.first_name} {program.member.last_name} ({program.member.member_code})
              </Link>
            ) : (
              "Modèle réutilisable"
            )}
            {program.coach && <span>· Coach {program.coach.full_name}</span>}
            {program.start_date && <span>· {formatDate(program.start_date)} → {formatDate(program.end_date)}</span>}
          </span>
        }
        actions={
          canEdit && (
            <>
              {program.member && <LogWorkoutDialog programId={id} memberId={program.member.id} days={days.map((d) => ({ id: d.id, label: dayLabel.get(d.id)! }))} />}
              {program.member && ctx.can("progress.manage_all", "progress.manage_assigned") && <ProgressDialog memberId={program.member.id} programId={id} />}
              <ProgramDialog
                trigger={<Button variant="outline"><Pencil aria-hidden /> Modifier</Button>}
                program={program}
                members={(members ?? []).map((m) => ({ id: m.id as string, label: `${m.first_name} ${m.last_name} (${m.member_code})` }))}
                coaches={coaches?.map((c) => ({ id: c.id as string, label: c.full_name as string }))}
              />
            </>
          )
        }
      />

      {program.goal && <p className="text-sm"><span className="text-muted-foreground">Objectif :</span> {program.goal}</p>}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="grid content-start gap-4 xl:col-span-2">
          {days.length === 0 && <p className="rounded-xl border border-dashed bg-card px-4 py-8 text-center text-sm text-muted-foreground">Aucun jour d&apos;entraînement pour l&apos;instant.</p>}
          {days.map((day) => (
            <Card key={day.id}>
              <CardHeader className="flex-row items-start justify-between gap-2">
                <div>
                  <CardTitle>Jour {day.day_number} — {day.title}</CardTitle>
                  {day.muscle_group && <p className="mt-1 text-sm text-muted-foreground">{day.muscle_group}</p>}
                </div>
                {canEdit && (
                  <div className="flex gap-1">
                    <ExerciseDialog programId={id} dayId={day.id} />
                    <DeleteItemButton programId={id} target="day" id={day.id} label={`le jour ${day.day_number}`} />
                  </div>
                )}
              </CardHeader>
              <CardContent>
                {day.workout_exercises.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucun exercice.</p>
                ) : (
                  <ol className="divide-y">
                    {day.workout_exercises.map((ex, i) => (
                      <li key={ex.id} className="flex items-start gap-3 py-2.5">
                        <span className="mt-0.5 w-5 text-right text-sm tabular-nums text-muted-foreground">{i + 1}.</span>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{ex.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {[ex.sets && `${ex.sets} séries`, ex.reps && `${ex.reps} rép.`, ex.load, ex.rest_seconds !== null && `repos ${ex.rest_seconds} s`].filter(Boolean).join(" · ")}
                          </p>
                          {ex.instructions && <p className="mt-1 text-sm">{ex.instructions}</p>}
                        </div>
                        {canEdit && <DeleteItemButton programId={id} target="exercise" id={ex.id} label={ex.name} />}
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
          ))}
          {canEdit && <div><DayDialog programId={id} nextDay={(days.at(-1)?.day_number ?? 0) + 1} /></div>}
        </div>

        <Card className="content-start">
          <CardHeader>
            <CardTitle>Séances réalisées</CardTitle>
            <p className="text-sm text-muted-foreground">{completedCount} séance{completedCount > 1 ? "s" : ""} complète{completedCount > 1 ? "s" : ""}</p>
          </CardHeader>
          <CardContent>
            {(logs ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune séance enregistrée.</p>
            ) : (
              <ul className="grid gap-2">
                {(logs as Array<{ id: string; performed_on: string; completed: boolean; notes: string | null; day_id: string | null }>).map((l) => (
                  <li key={l.id} className="flex items-start gap-2 text-sm">
                    {l.completed ? <CheckCircle2 className="mt-0.5 size-4 text-success" aria-label="Complète" /> : <CircleDashed className="mt-0.5 size-4 text-warning" aria-label="Partielle" />}
                    <div className="min-w-0 flex-1">
                      <p>{formatDate(l.performed_on)}{l.day_id && ` · ${dayLabel.get(l.day_id) ?? ""}`}</p>
                      {l.notes && <p className="text-xs text-muted-foreground">{l.notes}</p>}
                    </div>
                    {canEdit && <DeleteItemButton programId={id} target="log" id={l.id} label="cette séance" />}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
