"use client";

import { useState } from "react";
import { Plus, Users } from "lucide-react";
import { ActionDialog } from "@/components/app/action-dialog";
import { AvatarStack, InitialsAvatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";
import { bookMember, cancelSession, createSession, updateBooking } from "./actions";

export interface SessionView {
  id: string;
  kind: "group_class" | "personal_training";
  title: string;
  coach_id: string | null;
  room: string | null;
  starts_at: string;
  ends_at: string;
  capacity: number;
  status: "scheduled" | "cancelled" | "completed";
  notes: string | null;
  coach: { full_name: string } | null;
  bookings: Array<{ id: string; status: keyof typeof t.bookingStatus; member_id: string; member: { first_name: string; last_name: string; member_code: string } | null }>;
}

type CoachOption = { id: string; label: string; availability: Array<{ day: number; start: string; end: string }> };

export function NewSessionDialog({ coaches, canChooseCoach, defaultDate }: { coaches: CoachOption[]; canChooseCoach: boolean; defaultDate: string }) {
  return (
    <ActionDialog trigger={<Button><Plus aria-hidden /> Nouvelle séance</Button>} title="Nouvelle séance" action={createSession} wide>
      {(state) => <SessionFields errors={state.fieldErrors ?? {}} coaches={coaches} canChooseCoach={canChooseCoach} defaultDate={defaultDate} />}
    </ActionDialog>
  );
}

function SessionFields({
  errors: e,
  coaches,
  canChooseCoach,
  defaultDate,
}: {
  errors: Record<string, string>;
  coaches: CoachOption[];
  canChooseCoach: boolean;
  defaultDate: string;
}) {
  const [kind, setKind] = useState<SessionView["kind"]>("group_class");
  const [coachId, setCoachId] = useState("");
  const coach = coaches.find((c) => c.id === coachId);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type" htmlFor="kind">
          <NativeSelect id="kind" name="kind" value={kind} onChange={(ev) => setKind(ev.target.value as SessionView["kind"])}>
            <option value="group_class">{t.sessionKind.group_class}</option>
            <option value="personal_training">{t.sessionKind.personal_training}</option>
          </NativeSelect>
        </Field>
        <Field label="Titre" htmlFor="session_title" error={e.title} required>
          <Input id="session_title" name="title" placeholder={kind === "group_class" ? "Ex. CrossFit WOD" : "Ex. Coaching individuel"} />
        </Field>
        {canChooseCoach && (
          <Field label="Coach" htmlFor="session_coach" error={e.coach_id}>
            <NativeSelect id="session_coach" name="coach_id" value={coachId} onChange={(ev) => setCoachId(ev.target.value)}>
              <option value="">Aucun</option>
              {coaches.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </NativeSelect>
          </Field>
        )}
        <Field label="Salle" htmlFor="room" error={e.room}>
          <Input id="room" name="room" placeholder="Studio A" />
        </Field>
        <Field label="Date" htmlFor="session_date" error={e.date} required>
          <Input id="session_date" name="date" type="date" defaultValue={defaultDate} min={defaultDate} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Début" htmlFor="start_time" error={e.start_time} required>
            <Input id="start_time" name="start_time" type="time" defaultValue="18:00" />
          </Field>
          <Field label="Durée (min)" htmlFor="duration" error={e.duration}>
            <Input id="duration" name="duration" type="number" min={15} max={480} step={15} defaultValue={60} />
          </Field>
        </div>
        {kind === "group_class" && (
          <Field label="Capacité" htmlFor="capacity" error={e.capacity} required>
            <Input id="capacity" name="capacity" type="number" min={1} defaultValue={15} />
          </Field>
        )}
        <Field label="Répéter chaque semaine" htmlFor="repeat_weeks" error={e.repeat_weeks} hint="Nombre de semaines supplémentaires (0 à 12)">
          <Input id="repeat_weeks" name="repeat_weeks" type="number" min={0} max={12} defaultValue={0} />
        </Field>
      </div>
      {coach && (
        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          Disponibilités de {coach.label} :{" "}
          {coach.availability.length === 0
            ? "non renseignées"
            : coach.availability.map((s) => `${t.weekdays[s.day - 1]} ${s.start}–${s.end}`).join(" · ")}
        </p>
      )}
      <Field label="Notes" htmlFor="session_notes" error={e.notes}>
        <Textarea id="session_notes" name="notes" rows={2} />
      </Field>
    </>
  );
}

export function SessionCard({
  session,
  members,
  canBook,
  canManage,
}: {
  session: SessionView;
  members: Array<{ id: string; label: string }>;
  canBook: boolean;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const active = session.bookings.filter((b) => b.status !== "cancelled");
  const booked = session.bookings.filter((b) => b.status === "booked").length;
  const full = booked >= session.capacity;
  const cancelled = session.status === "cancelled";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "gradient-border edge-highlight group relative overflow-hidden rounded-lg border bg-card py-2 pl-3 pr-2 text-left shadow-card",
          "transition-all duration-300 ease-out hover:-translate-y-px hover:shadow-card-hover",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          cancelled && "opacity-50",
        )}
      >
        <span
          aria-hidden
          className={cn("absolute inset-y-1.5 left-1 w-0.5 rounded-full", session.kind === "personal_training" ? "bg-chart-2" : "bg-chart-1")}
        />
        <p className="text-[11px] font-medium tabular-nums text-muted-foreground">
          {formatTime(session.starts_at)} – {formatTime(session.ends_at)}
        </p>
        <p className={cn("mt-0.5 truncate text-[12px] font-medium tracking-[-0.01em]", cancelled && "line-through")}>{session.title}</p>
        {session.coach && (
          <p className="mt-1 flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
            <InitialsAvatar name={session.coach.full_name} className="size-4 text-[7px]" />
            {session.coach.full_name}
          </p>
        )}
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-secondary">
            <div
              className={cn("h-full rounded-full transition-all duration-500 ease-out", full ? "bg-red-500" : "bg-chart-1")}
              style={{ width: `${Math.max(4, Math.min(100, (booked / session.capacity) * 100))}%` }}
            />
          </div>
          <span className={cn("flex items-center gap-0.5 text-[10px] tabular-nums", full ? "font-medium text-red-600 dark:text-red-400" : "text-subtle-foreground")}>
            <Users className="size-3" strokeWidth={1.75} aria-hidden /> {booked}/{session.capacity}
          </span>
        </div>
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{session.title}</SheetTitle>
            <SheetDescription asChild>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Badge variant="outline">{t.sessionKind[session.kind]}</Badge>
                <Badge variant={cancelled ? "secondary" : "success"} dot={!cancelled}>{t.sessionStatus[session.status]}</Badge>
                <span className="text-[12px] tabular-nums">{formatDateTime(session.starts_at)} → {formatTime(session.ends_at)}</span>
              </div>
            </SheetDescription>
          </SheetHeader>
          <div className="grid flex-1 content-start gap-6 overflow-y-auto p-6 text-[13px]">
            <dl className="edge-highlight grid grid-cols-3 divide-x overflow-hidden rounded-xl border bg-background/60">
              <div className="px-3 py-2.5"><dt className="text-eyebrow">Coach</dt><dd className="mt-1.5 truncate font-medium">{session.coach?.full_name ?? "—"}</dd></div>
              <div className="px-3 py-2.5"><dt className="text-eyebrow">Salle</dt><dd className="mt-1.5 truncate font-medium">{session.room ?? "—"}</dd></div>
              <div className="px-3 py-2.5"><dt className="text-eyebrow">Places</dt><dd className={cn("mt-1.5 font-medium tabular-nums", full && "text-red-600 dark:text-red-400")}>{booked} / {session.capacity}</dd></div>
            </dl>
            {session.notes && <p className="rounded-lg bg-secondary/50 p-3 text-muted-foreground">{session.notes}</p>}

            {canBook && !cancelled && !full && new Date(session.starts_at) > new Date() && (
              <ActionDialog trigger={<Button variant="outline">Inscrire un membre</Button>} title="Inscrire un membre" action={bookMember} submitLabel="Inscrire">
                {(state) => (
                  <>
                    <input type="hidden" name="session_id" value={session.id} />
                    <Field label="Membre" htmlFor="book_member" error={state.fieldErrors?.member_id} required>
                      <NativeSelect id="book_member" name="member_id" defaultValue="">
                        <option value="" disabled>Choisir…</option>
                        {members.filter((m) => !active.some((b) => b.member_id === m.id)).map((m) => (
                          <option key={m.id} value={m.id}>{m.label}</option>
                        ))}
                      </NativeSelect>
                    </Field>
                  </>
                )}
              </ActionDialog>
            )}

            <div>
              <h3 className="text-eyebrow mb-2 flex items-center gap-2">
                Participants
                <AvatarStack names={active.map((b) => (b.member ? `${b.member.first_name} ${b.member.last_name}` : "Membre"))} max={5} size="size-5" />
              </h3>
              {active.length === 0 ? (
                <p className="rounded-lg border border-dashed px-3 py-6 text-center text-muted-foreground">Aucune inscription.</p>
              ) : (
                <ul className="divide-y divide-border/70 overflow-hidden rounded-xl border">
                  {active.map((b) => (
                    <li key={b.id} className="flex items-center justify-between gap-2 px-3 py-2 transition-colors duration-300 ease-out hover:bg-accent/30">
                      <span className="flex min-w-0 items-center gap-2.5">
                        <InitialsAvatar name={b.member ? `${b.member.first_name} ${b.member.last_name}` : "Membre"} className="size-6 text-[9px]" />
                        <span className="truncate">{b.member ? `${b.member.first_name} ${b.member.last_name}` : "Membre"}</span>
                        <Badge variant={b.status === "attended" ? "success" : b.status === "no_show" ? "danger" : "outline"}>{t.bookingStatus[b.status]}</Badge>
                      </span>
                      {canBook && b.status === "booked" && (
                        <span className="flex gap-1">
                          <BookingButton bookingId={b.id} status="attended" label="Présent" />
                          <BookingButton bookingId={b.id} status="no_show" label="Absent" />
                          <BookingButton bookingId={b.id} status="cancelled" label="Désinscrire" />
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {canManage && !cancelled && (
              <ActionDialog
                trigger={<Button variant="ghost" className="justify-self-start text-danger hover:text-danger">Annuler la séance</Button>}
                title="Annuler cette séance ?"
                description="Les participants inscrits devront être prévenus."
                action={cancelSession}
                submitLabel="Annuler la séance"
                destructive
              >
                {() => <input type="hidden" name="session_id" value={session.id} />}
              </ActionDialog>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function BookingButton({ bookingId, status, label }: { bookingId: string; status: "attended" | "no_show" | "cancelled"; label: string }) {
  return (
    <ActionDialog trigger={<Button size="sm" variant="ghost">{label}</Button>} title={`${label} ?`} action={updateBooking} submitLabel="Confirmer" destructive={status === "cancelled"}>
      {() => (
        <>
          <input type="hidden" name="booking_id" value={bookingId} />
          <input type="hidden" name="status" value={status} />
        </>
      )}
    </ActionDialog>
  );
}
