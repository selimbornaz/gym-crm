import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import {
  Activity,
  CalendarDays,
  Cake,
  ChevronRight,
  ClipboardList,
  CreditCard,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  QrCode,
  ShieldAlert,
  Siren,
  UserRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { MetricStrip } from "@/components/app/metric-strip";
import { MembershipBadge, PaymentBadge, SubscriptionBadge } from "@/components/app/status-badge";
import { InitialsAvatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { Tabs, TabsContent, TabsCount, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requirePagePermission } from "@/lib/auth/context";
import { formatDate, formatDateTime, formatMoney, formatRelative, formatTime, sumAmounts } from "@/lib/format";
import type { MemberRow, PaymentMethodRow, PaymentRow, PlanRow, SubscriptionRow } from "@/lib/types";
import { t } from "@/i18n";
import { NewSubscriptionDialog, RecordPaymentDialog, RefundDialog, SubscriptionManageButtons } from "../../billing/dialogs";
import { ArchiveMemberButton, MemberNotes, MemberPhoto } from "./member-widgets";

export const metadata: Metadata = { title: "Fiche membre" };

export default async function MemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePagePermission("members.read_all", "members.read_assigned");
  const db = ctx.supabase;
  const org = ctx.org.id;

  const { data: memberData } = await db.from("member_directory").select("*").eq("organization_id", org).eq("id", id).maybeSingle();
  if (!memberData) notFound();
  const member = memberData as MemberRow;

  const canSubs = ctx.can("subscriptions.read");
  const canPayments = ctx.can("payments.read");
  const canAttendance = ctx.can("attendance.read", "attendance.read_assigned");
  const canNotes = ctx.can("member_notes.manage");
  const canProgress = ctx.can("progress.manage_all", "progress.manage_assigned");
  const none = Promise.resolve({ data: null });

  const [photo, subs, payments, attendance, programs, progress, notes, plans, methods] = await Promise.all([
    member.photo_path ? db.storage.from("member-photos").createSignedUrl(member.photo_path, 3600) : none,
    canSubs ? db.from("subscription_overview").select("*").eq("organization_id", org).eq("member_id", id).order("start_date", { ascending: false }) : none,
    canPayments ? db.from("payment_ledger").select("*").eq("organization_id", org).eq("member_id", id).order("paid_at", { ascending: false }).limit(50) : none,
    canAttendance
      ? db.from("attendance").select("id, checked_in_at, checked_out_at, method, status, override_reason").eq("organization_id", org).eq("member_id", id).order("checked_in_at", { ascending: false }).limit(60)
      : none,
    db.from("workout_programs").select("id, name, status, start_date, end_date").eq("organization_id", org).eq("member_id", id).order("created_at", { ascending: false }),
    canProgress
      ? db.from("progress_entries").select("id, recorded_on, weight_kg, body_fat_pct, waist_cm, notes").eq("organization_id", org).eq("member_id", id).order("recorded_on", { ascending: false }).limit(20)
      : none,
    canNotes ? db.from("member_notes").select("id, body, created_at, created_by").eq("organization_id", org).eq("member_id", id).order("created_at", { ascending: false }) : none,
    ctx.can("subscriptions.write") ? db.from("membership_plans").select("*").eq("organization_id", org).eq("is_active", true).order("sort_order") : none,
    ctx.can("payments.create") ? db.from("payment_methods").select("id, name, code, is_active").eq("organization_id", org).eq("is_active", true) : none,
  ]);

  const photoUrl = (photo.data as { signedUrl?: string } | null)?.signedUrl ?? null;
  const subscriptions = (subs.data ?? []) as SubscriptionRow[];
  const paymentRows = (payments.data ?? []) as PaymentRow[];
  const attendanceRows = (attendance.data ?? []) as Array<{ id: string; checked_in_at: string; checked_out_at: string | null; method: keyof typeof t.checkinMethod; status: string; override_reason: string | null }>;
  const programRows = (programs.data ?? []) as Array<{ id: string; name: string; status: keyof typeof t.programStatus; start_date: string | null; end_date: string | null }>;
  const progressRows = (progress.data ?? []) as Array<{ id: string; recorded_on: string; weight_kg: number | null; body_fat_pct: number | null; waist_cm: number | null; notes: string | null }>;
  const openSubs = subscriptions.filter((s) => s.status !== "cancelled" && Number(s.balance) > 0);
  const totalDue = sumAmounts(subscriptions.filter((s) => s.status !== "cancelled").map((s) => s.balance));
  const currentSub = subscriptions.find((s) => s.effective_status === "active" || s.effective_status === "suspended");
  const since30 = Date.now() - 30 * 86_400_000;
  const visits30 = attendanceRows.filter((a) => a.status === "valid" && new Date(a.checked_in_at).getTime() >= since30).length;
  const lastVisit = attendanceRows.find((a) => a.status === "valid");
  const archived = member.archived_at !== null;
  const methodsList = (methods.data ?? []) as PaymentMethodRow[];

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6">
      {/* Fil d'Ariane ----------------------------------------------------------- */}
      <nav aria-label="Fil d'Ariane" className="flex items-center gap-1 text-[12px] text-muted-foreground">
        <Link href="/members" className="rounded px-1 transition-colors duration-300 ease-out hover:text-foreground">Membres</Link>
        <ChevronRight className="size-3.5 text-subtle-foreground" aria-hidden />
        <span className="truncate text-foreground">{member.full_name}</span>
      </nav>

      {/* En-tête héros ------------------------------------------------------------ */}
      <Card className="overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-indigo-500/[0.06] to-transparent" />
        <div className="relative flex flex-col gap-5 p-6 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-5">
            <MemberPhoto memberId={member.id} orgId={ctx.org.id} photoUrl={photoUrl} canEdit={ctx.can("members.write")} name={member.full_name} size="size-16" />
            <div className="min-w-0">
              <h1 className="truncate text-[22px] font-semibold leading-tight tracking-[-0.025em]">{member.full_name}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                <span className="rounded-md border bg-secondary/60 px-1.5 py-0.5 font-mono text-[11px] text-foreground">{member.member_code}</span>
                <MembershipBadge status={member.membership_status} />
                {member.membership_end_date && <span>jusqu&apos;au {formatDate(member.membership_end_date)}</span>}
                {member.coach_name && (
                  <span className="flex items-center gap-1.5">
                    <span className="text-subtle-foreground">·</span>
                    <InitialsAvatar name={member.coach_name} className="size-5 text-[9px]" />
                    {member.coach_name}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {ctx.can("attendance.write") && !archived && (
              <Button asChild variant="outline">
                <Link href={`/attendance?member=${member.id}`}>
                  <Activity aria-hidden /> Check-in
                </Link>
              </Button>
            )}
            {ctx.can("payments.create") && (
              <RecordPaymentDialog
                trigger={<Button variant="outline"><CreditCard aria-hidden /> Encaisser</Button>}
                memberId={member.id}
                subscriptions={openSubs}
                methods={methodsList}
                canBackdate={ctx.can("reports.financial")}
              />
            )}
            {ctx.can("subscriptions.write") && !archived && (
              <NewSubscriptionDialog
                trigger={<Button><Plus aria-hidden /> Abonnement</Button>}
                memberId={member.id}
                plans={(plans.data ?? []) as PlanRow[]}
                methods={methodsList}
                canPay={ctx.can("payments.create")}
              />
            )}
          </div>
        </div>
        {archived && (
          <p className="flex items-center gap-2 border-t bg-amber-500/[0.06] px-6 py-2.5 text-[12px] text-amber-700 dark:text-amber-400">
            <ShieldAlert className="size-4" strokeWidth={1.75} aria-hidden /> Membre archivé le {formatDate(member.archived_at)} — {member.archive_reason}
          </p>
        )}
      </Card>

      {/* Métriques ---------------------------------------------------------------- */}
      <MetricStrip
        metrics={[
          ...(canSubs
            ? [{ label: "Reste à payer", icon: Wallet, value: formatMoney(totalDue), tone: Number(totalDue) > 0 ? ("danger" as const) : undefined, hint: Number(totalDue) > 0 ? `${openSubs.length} abonnement${openSubs.length > 1 ? "s" : ""} à régler` : "Tout est réglé" }]
            : []),
          { label: "Formule en cours", icon: CalendarDays, value: <span className="text-[17px] tracking-[-0.02em]">{currentSub?.plan_name ?? "—"}</span>, hint: currentSub ? `${formatDate(currentSub.start_date)} → ${formatDate(currentSub.end_date)}` : "Aucun abonnement en cours" },
          { label: "Passages · 30 j", icon: Activity, value: visits30, hint: lastVisit ? `Dernier : ${formatRelative(lastVisit.checked_in_at)}` : "Aucun passage" },
          { label: "Membre depuis", icon: UserRound, value: <span className="text-[17px] tracking-[-0.02em]">{formatDate(member.registered_on)}</span>, hint: formatRelative(`${member.registered_on}T12:00:00Z`) },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* Coordonnées ------------------------------------------------------------ */}
        <Card className="h-fit">
          <div className="flex items-center justify-between px-5 pb-2 pt-4">
            <span className="text-eyebrow">Coordonnées</span>
            {ctx.can("members.write") && (
              <Button asChild size="sm" variant="ghost" className="h-7 px-2">
                <Link href={`/members/${member.id}/edit`}><Pencil aria-hidden /> Modifier</Link>
              </Button>
            )}
          </div>
          <dl className="grid gap-0.5 px-2 pb-2 text-[13px]">
            <InfoRow icon={Phone} label="Téléphone">
              {member.phone ? <a href={`tel:${member.phone}`} className="tabular-nums transition-colors duration-300 ease-out hover:text-foreground hover:underline">{member.phone}</a> : null}
            </InfoRow>
            <InfoRow icon={Mail} label="Email">{member.email}</InfoRow>
            <InfoRow icon={MapPin} label="Adresse">{member.address}</InfoRow>
            <InfoRow icon={Cake} label="Naissance">{member.birth_date ? formatDate(member.birth_date) : null}</InfoRow>
            <InfoRow icon={UserRound} label="Genre">{member.gender ? t.gender[member.gender] : null}</InfoRow>
            <InfoRow icon={Siren} label="Urgence">
              {member.emergency_contact_name ? `${member.emergency_contact_name}${member.emergency_contact_phone ? ` · ${member.emergency_contact_phone}` : ""}` : null}
            </InfoRow>
          </dl>
          <div className="flex flex-wrap gap-2 border-t px-5 py-3">
            <Button asChild size="sm" variant="outline">
              <Link href={`/members/${member.id}/card`}><QrCode aria-hidden /> Carte QR</Link>
            </Button>
            {ctx.can("members.archive") && <ArchiveMemberButton memberId={member.id} archived={archived} name={member.full_name} />}
          </div>
        </Card>

        {/* Onglets ---------------------------------------------------------------- */}
        <Tabs defaultValue={canSubs ? "subscriptions" : canAttendance ? "attendance" : "workouts"} className="min-w-0">
          <TabsList>
            {canSubs && <TabsTrigger value="subscriptions">Abonnements <TabsCount>{subscriptions.length}</TabsCount></TabsTrigger>}
            {canPayments && <TabsTrigger value="payments">Paiements <TabsCount>{paymentRows.length}</TabsCount></TabsTrigger>}
            {canAttendance && <TabsTrigger value="attendance">Présences</TabsTrigger>}
            <TabsTrigger value="workouts">Programmes <TabsCount>{programRows.length}</TabsCount></TabsTrigger>
            {canProgress && <TabsTrigger value="progress">Progression</TabsTrigger>}
            {canNotes && <TabsTrigger value="notes">Notes internes</TabsTrigger>}
          </TabsList>

          {canSubs && (
            <TabsContent value="subscriptions">
              {subscriptions.length === 0 ? (
                <Empty icon={CalendarDays}>Aucun abonnement.</Empty>
              ) : (
                <Table>
                  <THead>
                    <tr><Th>Formule</Th><Th>Période</Th><Th>Statut</Th><Th className="text-right">Montant</Th><Th className="text-right">Payé</Th><Th>Règlement</Th>{ctx.can("subscriptions.manage") && <Th />}</tr>
                  </THead>
                  <TBody>
                    {subscriptions.map((s) => (
                      <Tr key={s.id}>
                        <Td>
                          <p className="font-medium">{s.plan_name}</p>
                          {Number(s.discount) > 0 && <p className="text-[11px] text-subtle-foreground">Remise {formatMoney(s.discount)}</p>}
                          {s.cancel_reason && <p className="text-[11px] text-subtle-foreground">Annulé : {s.cancel_reason}</p>}
                        </Td>
                        <Td className="whitespace-nowrap tabular-nums text-muted-foreground">{formatDate(s.start_date)} → {formatDate(s.end_date)}</Td>
                        <Td><SubscriptionBadge status={s.effective_status} /></Td>
                        <Td className="text-right tabular-nums">{formatMoney(s.total_due)}</Td>
                        <Td className="text-right tabular-nums text-muted-foreground">{formatMoney(s.amount_paid)}</Td>
                        <Td>{s.status === "cancelled" ? <span className="text-subtle-foreground">—</span> : <PaymentBadge status={s.payment_status} />}</Td>
                        {ctx.can("subscriptions.manage") && <Td><SubscriptionManageButtons sub={s} /></Td>}
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              )}
            </TabsContent>
          )}

          {canPayments && (
            <TabsContent value="payments">
              {paymentRows.length === 0 ? (
                <Empty icon={CreditCard}>Aucun paiement.</Empty>
              ) : (
                <Table>
                  <THead>
                    <tr><Th>Reçu</Th><Th>Date</Th><Th>Affectation</Th><Th>Moyen</Th><Th className="text-right">Montant</Th><Th /></tr>
                  </THead>
                  <TBody>
                    {paymentRows.map((p) => (
                      <Tr key={p.id}>
                        <Td>
                          <Link href={`/payments/${p.id}/receipt`} className="rounded-md border bg-secondary/60 px-1.5 py-0.5 font-mono text-[11px] transition-all duration-300 ease-out hover:border-border-strong hover:bg-accent">
                            {p.receipt_number}
                          </Link>
                        </Td>
                        <Td className="whitespace-nowrap tabular-nums text-muted-foreground">{formatDateTime(p.paid_at)}</Td>
                        <Td>{p.plan_name ?? <span className="text-subtle-foreground">Hors abonnement</span>}</Td>
                        <Td><Badge variant="outline">{p.method_name}</Badge></Td>
                        <Td className="text-right">
                          <span className="font-medium tabular-nums">{formatMoney(p.amount)}</span>
                          {Number(p.refunded_amount) > 0 && <span className="block text-[11px] text-amber-600 dark:text-amber-400">− {formatMoney(p.refunded_amount)} remboursé</span>}
                        </Td>
                        <Td className="text-right">{ctx.can("payments.refund") && <RefundDialog payment={p} />}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              )}
            </TabsContent>
          )}

          {canAttendance && (
            <TabsContent value="attendance">
              {attendanceRows.length === 0 ? (
                <Empty icon={Activity}>Aucun passage enregistré.</Empty>
              ) : (
                <Card>
                  <ol className="divide-y divide-border/70">
                    {attendanceRows.slice(0, 30).map((a) => (
                      <li key={a.id} className={`flex items-center gap-4 px-5 py-3 text-[13px] transition-colors duration-300 ease-out hover:bg-accent/30 ${a.status === "voided" ? "opacity-50" : ""}`}>
                        <span className={`size-2 shrink-0 rounded-full ${a.status === "voided" ? "bg-zinc-400" : a.override_reason ? "bg-amber-500" : "bg-emerald-500"}`} aria-hidden />
                        <span className="w-28 shrink-0 tabular-nums">{formatDate(a.checked_in_at)}</span>
                        <span className="tabular-nums text-muted-foreground">{formatTime(a.checked_in_at)} → {a.checked_out_at ? formatTime(a.checked_out_at) : "…"}</span>
                        <span className="ml-auto flex items-center gap-2">
                          {a.status === "voided" && <Badge variant="secondary">Annulé</Badge>}
                          {a.override_reason && <Badge variant="warning">Dérogation</Badge>}
                          <Badge variant="outline">{t.checkinMethod[a.method]}</Badge>
                        </span>
                      </li>
                    ))}
                  </ol>
                </Card>
              )}
            </TabsContent>
          )}

          <TabsContent value="workouts">
            {programRows.length === 0 ? (
              <Empty icon={ClipboardList}>
                Aucun programme.
                {ctx.can("workouts.manage_all", "workouts.manage_assigned") && (
                  <> <Link href={`/workouts?member=${member.id}`} className="font-medium text-foreground underline-offset-4 hover:underline">Créer un programme</Link></>
                )}
              </Empty>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {programRows.map((p) => (
                  <Link key={p.id} href={`/workouts/${p.id}`} className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                    <Card interactive className="flex items-center justify-between gap-3 p-4">
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium">{p.name}</span>
                        <span className="block text-[11px] text-subtle-foreground">{p.start_date ? `${formatDate(p.start_date)} → ${formatDate(p.end_date)}` : "Sans dates"}</span>
                      </span>
                      <Badge variant={p.status === "active" ? "success" : "outline"} dot={p.status === "active"}>{t.programStatus[p.status]}</Badge>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </TabsContent>

          {canProgress && (
            <TabsContent value="progress">
              {progressRows.length === 0 ? (
                <Empty icon={Activity}>Aucune mesure. Les coachs les ajoutent depuis le programme du membre.</Empty>
              ) : (
                <Table>
                  <THead><tr><Th>Date</Th><Th className="text-right">Poids</Th><Th className="text-right">Masse grasse</Th><Th className="text-right">Tour de taille</Th><Th>Notes</Th></tr></THead>
                  <TBody>
                    {progressRows.map((p) => (
                      <Tr key={p.id}>
                        <Td className="tabular-nums">{formatDate(p.recorded_on)}</Td>
                        <Td className="text-right tabular-nums">{p.weight_kg ? `${p.weight_kg} kg` : "—"}</Td>
                        <Td className="text-right tabular-nums">{p.body_fat_pct ? `${p.body_fat_pct} %` : "—"}</Td>
                        <Td className="text-right tabular-nums">{p.waist_cm ? `${p.waist_cm} cm` : "—"}</Td>
                        <Td className="text-[12px] text-muted-foreground">{p.notes}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              )}
            </TabsContent>
          )}

          {canNotes && (
            <TabsContent value="notes">
              <MemberNotes
                memberId={member.id}
                currentUserId={ctx.user.id}
                notes={(notes.data ?? []) as Array<{ id: string; body: string; created_at: string; created_by: string | null }>}
              />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  );
}

function InfoRow({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-lg px-3 py-2 transition-colors duration-300 ease-out hover:bg-accent/40">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-subtle-foreground" strokeWidth={1.75} aria-hidden />
      <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{children ?? <span className="text-subtle-foreground">—</span>}</dd>
    </div>
  );
}

function Empty({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-10 text-center text-[13px] text-muted-foreground">
      <Icon className="size-5 text-subtle-foreground" strokeWidth={1.5} aria-hidden />
      <p>{children}</p>
    </div>
  );
}
