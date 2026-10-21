import type { Metadata } from "next";
import Link from "next/link";
import { Dumbbell, Mail, Phone } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { InitialsAvatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { requirePagePermission } from "@/lib/auth/context";
import type { CoachRow } from "@/lib/types";
import { t } from "@/i18n";
import { CoachDialog } from "./coach-dialog";

export const metadata: Metadata = { title: "Coachs" };

export default async function CoachesPage() {
  const ctx = await requirePagePermission("coaches.read");
  const [{ data }, { data: assigned }] = await Promise.all([
    ctx.supabase.from("coaches").select("*").eq("organization_id", ctx.org.id).order("is_active", { ascending: false }).order("full_name"),
    // Nombre de membres assignés (RLS : un coach ne compte que les siens).
    ctx.supabase.from("members").select("coach_id").eq("organization_id", ctx.org.id).is("archived_at", null).not("coach_id", "is", null),
  ]);
  const coaches = (data ?? []) as CoachRow[];
  const counts = new Map<string, number>();
  for (const m of (assigned ?? []) as Array<{ coach_id: string }>) counts.set(m.coach_id, (counts.get(m.coach_id) ?? 0) + 1);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Coachs" description="Spécialités, disponibilités et membres suivis." actions={ctx.can("coaches.manage") && <CoachDialog />} />
      {coaches.length === 0 ? (
        <EmptyState icon={Dumbbell} title="Aucun coach" description="Ajoutez vos coachs pour leur assigner des membres et des séances." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {coaches.map((c) => (
            <Card key={c.id} className={c.is_active ? undefined : "opacity-60"}>
              <CardContent className="grid gap-4 p-5">
                <div className="flex items-start gap-3">
                  <InitialsAvatar name={c.full_name} className="size-11" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{c.full_name}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {c.specialties.map((s) => <Badge key={s} variant="secondary">{s}</Badge>)}
                      {!c.is_active && <Badge variant="outline">Inactif</Badge>}
                      {c.staff_id && <Badge variant="info">Compte lié</Badge>}
                    </div>
                  </div>
                  {ctx.can("coaches.manage") && <CoachDialog coach={c} />}
                </div>
                <div className="grid gap-1 text-sm text-muted-foreground">
                  {c.phone && <p className="flex items-center gap-2"><Phone className="size-3.5" aria-hidden /> {c.phone}</p>}
                  {c.email && <p className="flex items-center gap-2"><Mail className="size-3.5" aria-hidden /> {c.email}</p>}
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Disponibilités</p>
                  {c.availability.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Non renseignées</p>
                  ) : (
                    <ul className="grid gap-0.5 text-sm">
                      {[1, 2, 3, 4, 5, 6, 7].filter((d) => c.availability.some((s) => s.day === d)).map((d) => (
                        <li key={d} className="flex justify-between gap-2">
                          <span>{t.weekdays[d - 1]}</span>
                          <span className="tabular-nums text-muted-foreground">
                            {c.availability.filter((s) => s.day === d).map((s) => `${s.start}–${s.end}`).join(", ")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <Link href={`/members?coach=${c.id}`} className="text-sm underline-offset-4 hover:underline">
                  {counts.get(c.id) ?? 0} membre{(counts.get(c.id) ?? 0) > 1 ? "s" : ""} assigné{(counts.get(c.id) ?? 0) > 1 ? "s" : ""}
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
