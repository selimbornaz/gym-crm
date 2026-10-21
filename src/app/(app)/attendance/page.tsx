import type { Metadata } from "next";
import Link from "next/link";
import { LogIn, ShieldAlert, Users } from "lucide-react";
import { ActionDialogButton, CorrectAttendanceDialog } from "./attendance-dialogs";
import { PageHeader } from "@/components/app/page-header";
import { StatCard } from "@/components/app/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { requirePagePermission } from "@/lib/auth/context";
import { addDaysIso, formatDateLong, formatTime, todayInTunis, tunisLocalToIso } from "@/lib/format";
import { t } from "@/i18n";
import { CheckInDesk } from "./check-in-desk";
import type { CheckInCandidate } from "./actions";

export const metadata: Metadata = { title: "Présences" };

interface AttendanceRow {
  id: string;
  member_id: string;
  checked_in_at: string;
  checked_out_at: string | null;
  method: keyof typeof t.checkinMethod;
  status: "valid" | "voided";
  override_reason: string | null;
  correction_reason: string | null;
  member: { member_code: string; first_name: string; last_name: string } | null;
}

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ date?: string; member?: string }> }) {
  const sp = await searchParams;
  const ctx = await requirePagePermission("attendance.write", "attendance.read", "attendance.read_assigned");
  const today = todayInTunis();
  const day = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  const isToday = day === today;

  const [{ data }, preselected] = await Promise.all([
    ctx.supabase
      .from("attendance")
      .select("id, member_id, checked_in_at, checked_out_at, method, status, override_reason, correction_reason, member:members(member_code, first_name, last_name)")
      .eq("organization_id", ctx.org.id)
      .gte("checked_in_at", tunisLocalToIso(`${day}T00:00`))
      .lt("checked_in_at", tunisLocalToIso(`${addDaysIso(day, 1)}T00:00`))
      .order("checked_in_at", { ascending: false })
      .limit(500),
    sp.member && /^[0-9a-f-]{36}$/.test(sp.member) && ctx.can("attendance.write")
      ? ctx.supabase
          .from("member_directory")
          .select("id, member_code, full_name, phone, membership_status, membership_end_date")
          .eq("organization_id", ctx.org.id)
          .eq("id", sp.member)
          .maybeSingle()
          .then((r) => r.data as CheckInCandidate | null)
      : Promise.resolve(null),
  ]);
  const rows = (data ?? []) as unknown as AttendanceRow[];
  const valid = rows.filter((r) => r.status === "valid");
  const present = valid.filter((r) => !r.checked_out_at).length;
  const overrides = valid.filter((r) => r.override_reason).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Présences" description={<span className="capitalize">{formatDateLong(day)}</span>} />

      {ctx.can("attendance.write") && isToday && <CheckInDesk preselected={preselected} />}

      <section className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <StatCard label={isToday ? "Entrées aujourd'hui" : "Entrées"} value={String(valid.length)} icon={LogIn} />
        {isToday && <StatCard label="Encore présents" value={String(present)} icon={Users} />}
        <StatCard label="Entrées forcées" value={String(overrides)} icon={ShieldAlert} tone={overrides > 0 ? "warning" : undefined} hint="Avec dérogation du propriétaire" />
      </section>

      <form method="get" className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <label htmlFor="date" className="text-sm font-medium">Historique du</label>
          <Input id="date" name="date" type="date" defaultValue={day} max={today} className="bg-card" />
        </div>
        <Button type="submit" variant="secondary">Afficher</Button>
        {!isToday && <Button asChild variant="ghost"><Link href="/attendance">Aujourd&apos;hui</Link></Button>}
      </form>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-card px-4 py-8 text-center text-sm text-muted-foreground">Aucun passage ce jour-là.</p>
      ) : (
        <Table>
          <THead>
            <tr><Th>Membre</Th><Th>Entrée</Th><Th>Sortie</Th><Th>Méthode</Th><Th>Remarque</Th><Th /></tr>
          </THead>
          <TBody>
            {rows.map((r) => (
              <Tr key={r.id} className={r.status === "voided" ? "opacity-50" : undefined}>
                <Td>
                  <Link href={`/members/${r.member_id}`} className="font-medium hover:underline">
                    {r.member ? `${r.member.first_name} ${r.member.last_name}` : "—"}
                  </Link>
                  <p className="font-mono text-xs text-muted-foreground">{r.member?.member_code}</p>
                </Td>
                <Td className="tabular-nums">{formatTime(r.checked_in_at)}</Td>
                <Td className="tabular-nums">{formatTime(r.checked_out_at)}</Td>
                <Td>{t.checkinMethod[r.method]}</Td>
                <Td className="text-xs">
                  {r.status === "voided" && <Badge variant="secondary">Annulé</Badge>}
                  {r.override_reason && <Badge variant="warning">Dérogation : {r.override_reason}</Badge>}
                  {r.correction_reason && <span className="block text-muted-foreground">Corrigé : {r.correction_reason}</span>}
                </Td>
                <Td className="text-right">
                  <div className="flex justify-end gap-1">
                    {isToday && r.status === "valid" && !r.checked_out_at && ctx.can("attendance.write") && (
                      <ActionDialogButton attendanceId={r.id} />
                    )}
                    {ctx.can("attendance.correct") && r.status === "valid" && <CorrectAttendanceDialog row={r} />}
                  </div>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
