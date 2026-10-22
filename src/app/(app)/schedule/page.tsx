import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { requirePagePermission } from "@/lib/auth/context";
import { addDaysIso, formatDate, todayInTunis, tunisLocalToIso } from "@/lib/format";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";
import type { CoachRow } from "@/lib/types";
import { NewSessionDialog, SessionCard, type SessionView } from "./schedule-widgets";

export const metadata: Metadata = { title: "Planning" };

/** Lundi de la semaine contenant `iso`. */
function mondayOf(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const offset = (d.getUTCDay() + 6) % 7;
  return addDaysIso(iso, -offset);
}

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const sp = await searchParams;
  const ctx = await requirePagePermission("schedule.read");
  const today = todayInTunis();
  const monday = mondayOf(sp.week && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? sp.week : today);
  const days = Array.from({ length: 7 }, (_, i) => addDaysIso(monday, i));
  const canManage = ctx.can("schedule.manage", "schedule.manage_own");
  const canBook = ctx.can("bookings.manage", "schedule.manage_own");
  const isCurrentWeek = days.includes(today);

  const [{ data }, { data: coaches }, { data: members }] = await Promise.all([
    ctx.supabase
      .from("sessions")
      .select("id, kind, title, coach_id, room, starts_at, ends_at, capacity, status, notes, coach:coaches(full_name), bookings(id, status, member_id, member:members(first_name, last_name, member_code))")
      .eq("organization_id", ctx.org.id)
      .gte("starts_at", tunisLocalToIso(`${monday}T00:00`))
      .lt("starts_at", tunisLocalToIso(`${addDaysIso(monday, 7)}T00:00`))
      .order("starts_at"),
    ctx.supabase.from("coaches").select("id, full_name, availability, specialties, is_active").eq("organization_id", ctx.org.id).eq("is_active", true).order("full_name"),
    canBook
      ? ctx.supabase.from("members").select("id, first_name, last_name, member_code").eq("organization_id", ctx.org.id).is("archived_at", null).order("last_name").limit(2000)
      : Promise.resolve({ data: null }),
  ]);
  const sessions = (data ?? []) as unknown as SessionView[];
  const memberOptions = (members ?? []).map((m) => ({ id: m.id as string, label: `${m.first_name} ${m.last_name} (${m.member_code})` }));
  const coachOptions = ((coaches ?? []) as Pick<CoachRow, "id" | "full_name" | "availability">[]).map((c) => ({
    id: c.id,
    label: c.full_name,
    availability: c.availability,
  }));
  const scheduled = sessions.filter((s) => s.status === "scheduled");
  const booked = scheduled.reduce((n, s) => n + s.bookings.filter((b) => b.status === "booked").length, 0);
  const capacity = scheduled.reduce((n, s) => n + s.capacity, 0);

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6">
      <PageHeader
        title="Planning"
        description={`Semaine du ${formatDate(monday)} au ${formatDate(addDaysIso(monday, 6))} · ${scheduled.length} séance${scheduled.length > 1 ? "s" : ""} · remplissage ${capacity === 0 ? "—" : `${Math.round((booked / capacity) * 100)} %`}`}
        actions={
          <>
            <div className="edge-highlight flex items-center rounded-lg border bg-card p-0.5 shadow-card">
              <Link href={`?week=${addDaysIso(monday, -7)}`} aria-label="Semaine précédente" className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-all duration-300 ease-out hover:bg-accent hover:text-foreground">
                <ChevronLeft className="size-4" strokeWidth={1.75} />
              </Link>
              <Link
                href="/schedule"
                className={cn(
                  "rounded-md px-3 py-1 text-[12px] font-medium transition-all duration-300 ease-out hover:bg-accent hover:text-foreground",
                  isCurrentWeek ? "text-foreground" : "text-muted-foreground",
                )}
              >
                Cette semaine
              </Link>
              <Link href={`?week=${addDaysIso(monday, 7)}`} aria-label="Semaine suivante" className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-all duration-300 ease-out hover:bg-accent hover:text-foreground">
                <ChevronRight className="size-4" strokeWidth={1.75} />
              </Link>
            </div>
            {canManage && <NewSessionDialog coaches={coachOptions} canChooseCoach={ctx.can("schedule.manage")} defaultDate={today >= monday ? today : monday} />}
          </>
        }
      />

      <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-3 w-0.5 rounded-full bg-chart-1" aria-hidden /> {t.sessionKind.group_class}</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-0.5 rounded-full bg-chart-2" aria-hidden /> {t.sessionKind.personal_training}</span>
      </div>

      <div className="-mx-4 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0">
        <div className="edge-highlight grid min-w-[980px] grid-cols-7 divide-x divide-border/80 overflow-hidden rounded-2xl border bg-card/40 shadow-card">
          {days.map((day, i) => {
            const daySessions = sessions.filter((s) => todayInTunis(new Date(s.starts_at)) === day);
            const isToday = day === today;
            const past = day < today;
            return (
              <section key={day} aria-label={`${t.weekdays[i]} ${formatDate(day)}`} className={cn("flex min-h-[420px] flex-col", isToday && "bg-indigo-500/[0.03]")}>
                <header className="flex items-baseline gap-2 border-b px-3 py-3">
                  <span className={cn("text-eyebrow", isToday && "text-indigo-600 dark:text-indigo-300")}>{(t.weekdays[i] ?? "").slice(0, 3)}.</span>
                  <span
                    className={cn(
                      "text-figure text-[18px] leading-none",
                      past && "text-subtle-foreground",
                      isToday && "rounded-md bg-indigo-500 px-1.5 py-0.5 text-[15px] text-white dark:bg-indigo-400 dark:text-zinc-950",
                    )}
                  >
                    {Number(day.slice(8, 10))}
                  </span>
                  <span className="ml-auto text-[10px] text-subtle-foreground">{MONTHS[Number(day.slice(5, 7)) - 1]}</span>
                </header>
                <div className="flex flex-1 flex-col gap-2 p-2">
                  {daySessions.length === 0 && <p className="px-1 py-2 text-[11px] text-subtle-foreground">Aucune séance</p>}
                  {daySessions.map((s) => (
                    <SessionCard key={s.id} session={s} members={memberOptions} canBook={canBook} canManage={canManage} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
