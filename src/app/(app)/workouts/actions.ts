"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authorize, dbErrorMessage, parseForm } from "@/lib/actions";
import type { ActionState } from "@/lib/action-state";
import { getMyCoachId } from "@/lib/coach";
import { isoDate, optionalText, uuid } from "@/lib/validation";

// Toutes les écritures passent par la session de l'utilisateur : la RLS
// garantit qu'un coach ne modifie que les programmes de SES membres.
const WRITE = ["workouts.manage_all", "workouts.manage_assigned"] as const;

const programSchema = z
  .object({
    program_id: uuid.optional(),
    name: z.string().trim().min(2, "Nom requis").max(120),
    member_id: uuid.optional(),
    coach_id: uuid.optional(),
    goal: optionalText(200),
    start_date: isoDate.optional(),
    end_date: isoDate.optional(),
    status: z.enum(["draft", "active", "completed", "archived"]).default("draft"),
    notes: optionalText(1000),
  })
  .refine((p) => !p.start_date || !p.end_date || p.end_date >= p.start_date, { message: "La fin doit suivre le début", path: ["end_date"] });

export async function saveProgram(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize(...WRITE);
  if (auth.denied) return auth.denied;
  const { ctx } = auth;
  const parsed = parseForm(programSchema, formData);
  if (parsed.error) return parsed.error;
  const { program_id, ...p } = parsed.data;

  // Un coach est toujours l'auteur de ses programmes.
  const coachId = ctx.can("workouts.manage_all") ? (p.coach_id ?? null) : await getMyCoachId(ctx);
  if (!ctx.can("workouts.manage_all") && !coachId) return { error: "Aucune fiche coach n'est liée à votre compte." };

  const row = {
    name: p.name, member_id: p.member_id ?? null, coach_id: coachId, goal: p.goal ?? null,
    start_date: p.start_date ?? null, end_date: p.end_date ?? null, status: p.status, notes: p.notes ?? null,
  };
  if (program_id) {
    const { error, count } = await ctx.supabase.from("workout_programs").update(row, { count: "exact" })
      .eq("organization_id", ctx.org.id).eq("id", program_id);
    if (error) return { error: dbErrorMessage(error) };
    if (!count) return { error: "Programme introuvable ou non autorisé." };
    revalidatePath(`/workouts/${program_id}`);
    return { ok: true, message: "Programme mis à jour." };
  }
  const { data, error } = await ctx.supabase.from("workout_programs").insert({ ...row, organization_id: ctx.org.id }).select("id").single();
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/workouts");
  redirect(`/workouts/${data.id}`);
}

export async function addWorkoutDay(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize(...WRITE);
  if (auth.denied) return auth.denied;
  const parsed = parseForm(
    z.object({
      program_id: uuid,
      day_number: z.coerce.number().int().min(1, "Entre 1 et 14").max(14, "Entre 1 et 14"),
      title: z.string().trim().min(1, "Titre requis").max(80),
      muscle_group: optionalText(80),
    }),
    formData,
  );
  if (parsed.error) return parsed.error;
  const { error } = await auth.ctx.supabase.from("workout_days").insert({
    organization_id: auth.ctx.org.id, program_id: parsed.data.program_id, day_number: parsed.data.day_number,
    title: parsed.data.title, muscle_group: parsed.data.muscle_group ?? null, position: parsed.data.day_number,
  });
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath(`/workouts/${parsed.data.program_id}`);
  return { ok: true, message: "Jour ajouté." };
}

export async function addExercise(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize(...WRITE);
  if (auth.denied) return auth.denied;
  const parsed = parseForm(
    z.object({
      program_id: uuid,
      day_id: uuid,
      name: z.string().trim().min(1, "Nom requis").max(120),
      sets: z.coerce.number().int().min(1, "Entre 1 et 50").max(50, "Entre 1 et 50").optional(),
      reps: optionalText(40),
      rest_seconds: z.coerce.number().int().min(0).max(900, "900 s maximum").optional(),
      load: optionalText(40),
      instructions: optionalText(500),
    }),
    formData,
  );
  if (parsed.error) return parsed.error;
  const { program_id, ...e } = parsed.data;
  const { count } = await auth.ctx.supabase.from("workout_exercises").select("id", { count: "exact", head: true })
    .eq("organization_id", auth.ctx.org.id).eq("day_id", e.day_id);
  const { error } = await auth.ctx.supabase.from("workout_exercises").insert({
    organization_id: auth.ctx.org.id, day_id: e.day_id, name: e.name, sets: e.sets ?? null, reps: e.reps ?? null,
    rest_seconds: e.rest_seconds ?? null, load: e.load ?? null, instructions: e.instructions ?? null, position: count ?? 0,
  });
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath(`/workouts/${program_id}`);
  return { ok: true, message: "Exercice ajouté." };
}

const deleteSchema = z.object({ program_id: uuid, target: z.enum(["day", "exercise", "log"]), id: uuid });

export async function deleteWorkoutItem(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize(...WRITE);
  if (auth.denied) return auth.denied;
  const parsed = parseForm(deleteSchema, formData);
  if (parsed.error) return parsed.error;
  const table = { day: "workout_days", exercise: "workout_exercises", log: "workout_logs" }[parsed.data.target];
  const { error, count } = await auth.ctx.supabase.from(table).delete({ count: "exact" })
    .eq("organization_id", auth.ctx.org.id).eq("id", parsed.data.id);
  if (error) return { error: dbErrorMessage(error) };
  if (!count) return { error: "Élément introuvable ou non autorisé." };
  revalidatePath(`/workouts/${parsed.data.program_id}`);
  return { ok: true, message: "Supprimé." };
}

export async function logWorkout(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize(...WRITE);
  if (auth.denied) return auth.denied;
  const parsed = parseForm(
    z.object({
      program_id: uuid,
      member_id: uuid,
      day_id: uuid.optional(),
      performed_on: isoDate,
      completed: z.enum(["true", "false"]),
      notes: optionalText(500),
    }),
    formData,
  );
  if (parsed.error) return parsed.error;
  const d = parsed.data;
  const { error } = await auth.ctx.supabase.from("workout_logs").insert({
    organization_id: auth.ctx.org.id, program_id: d.program_id, member_id: d.member_id, day_id: d.day_id ?? null,
    performed_on: d.performed_on, completed: d.completed === "true", notes: d.notes ?? null,
  });
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath(`/workouts/${d.program_id}`);
  return { ok: true, message: "Séance enregistrée." };
}

const measure = (max: number) => z.coerce.number().min(0).max(max).optional();

export async function addProgress(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize("progress.manage_all", "progress.manage_assigned");
  if (auth.denied) return auth.denied;
  const parsed = parseForm(
    z.object({
      program_id: uuid.optional(),
      member_id: uuid,
      recorded_on: isoDate,
      weight_kg: z.coerce.number().min(20, "Poids invalide").max(400, "Poids invalide").optional(),
      body_fat_pct: z.coerce.number().min(2, "Entre 2 et 70").max(70, "Entre 2 et 70").optional(),
      waist_cm: measure(300),
      chest_cm: measure(300),
      arm_cm: measure(150),
      thigh_cm: measure(200),
      notes: optionalText(500),
    }),
    formData,
  );
  if (parsed.error) return parsed.error;
  const { program_id, ...d } = parsed.data;
  const { error } = await auth.ctx.supabase.from("progress_entries").insert({ ...d, organization_id: auth.ctx.org.id });
  if (error) return { error: dbErrorMessage(error) };
  if (program_id) revalidatePath(`/workouts/${program_id}`);
  revalidatePath(`/members/${d.member_id}`);
  return { ok: true, message: "Mesures enregistrées." };
}
