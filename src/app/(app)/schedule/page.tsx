import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { requirePagePermission } from "@/lib/auth/context";
import { addDaysIso, formatDate, todayInTunis, tunisLocalToIso } from "@/lib/format";
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

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const sp = await searchParams;
  const ctx = await requirePagePermission("schedule.read");
  const today = todayInTunis();
  const monday = mondayOf(sp.week && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? sp.week : today);
  const days = Array.from({ length: 7 }, (_, i) => addDaysIso(monday, i));
  const canManage = ctx.can("schedule.manage", "schedule.manage_own");
  const canBook = ctx.can("bookings.manage", "schedule.manage_own");

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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Planning"
        description={`Semaine du ${formatDate(monday)} au ${formatDate(addDaysIso(monday, 6))}`}
        actions={
          <>
            <Button asChild variant="outline" size="icon" aria-label="Semaine précédente">
              <Link href={`?week=${addDaysIso(monday, -7)}`}><ChevronLeft /></Link>
            </Button>
            <Button asChild variant="outline"><Link href="/schedule">Cette semaine</Link></Button>
            <Button asChild variant="outline" size="icon" aria-label="Semaine suivante">
              <Link href={`?week=${addDaysIso(monday, 7)}`}><ChevronRight /></Link>
            </Button>
            {canManage && <NewSessionDialog coaches={coachOptions} canChooseCoach={ctx.can("schedule.manage")} defaultDate={today >= monday ? today : monday} />}
          </>
        }
      />

      <div className="grid gap-3 md:grid-cols-7">
        {days.map((day, i) => {
          const daySessions = sessions.filter((s) => tunisDate(s.starts_at) === day);
          return (
            <section key={day} aria-label={`${t.weekdays[i]} ${formatDate(day)}`} className={`flex flex-col gap-2 rounded-xl border bg-card p-2 ${day === today ? "ring-2 ring-ring/40" : ""}`}>
              <header className="px-1 pb-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t.weekdays[i]}</p>
                <p className="text-sm font-semibold">{formatDate(day).slice(0, 5)}</p>
              </header>
              {daySessions.length === 0 && <p className="px-1 text-xs text-muted-foreground">—</p>}
              {daySessions.map((s) => (
                <SessionCard key={s.id} session={s} members={memberOptions} canBook={canBook} canManage={canManage} />
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function tunisDate(iso: string): string {
  return todayInTunis(new Date(iso));
}
