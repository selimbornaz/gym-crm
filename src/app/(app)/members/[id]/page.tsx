import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, CreditCard, Mail, MapPin, Pencil, Phone, Plus, QrCode, ShieldAlert, UserRound } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { MembershipBadge, PaymentBadge, SubscriptionBadge } from "@/components/app/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requirePagePermission } from "@/lib/auth/context";
import { formatDate, formatDateTime, formatMoney, formatTime, sumAmounts } from "@/lib/format";
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
      ? db.from("attendance").select("id, checked_in_at, checked_out_at, method, status, override_reason").eq("organization_id", org).eq("member_id", id).order("checked_in_at", { ascending: false }).limit(30)
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
  const archived = member.archived_at !== null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={member.full_name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{member.member_code}</span>
            <MembershipBadge status={member.membership_status} />
            {member.membership_end_date && <span>jusqu&apos;au {formatDate(member.membership_end_date)}</span>}
          </span>
        }
        actions={
          <>
            {ctx.can("attendance.write") && !archived && (
              <Button asChild variant="outline">
                <Link href={`/attendance?member=${member.id}`}>
                  <Activity aria-hidden /> Check-in
                </Link>
              </Button>
            )}
            {ctx.can("subscriptions.write") && !archived && (
              <NewSubscriptionDialog
                trigger={<Button><Plus aria-hidden /> Abonnement</Button>}
                memberId={member.id}
                plans={(plans.data ?? []) as PlanRow[]}
                methods={(methods.data ?? []) as PaymentMethodRow[]}
                canPay={ctx.can("payments.create")}
              />
            )}
            {ctx.can("payments.create") && (
              <RecordPaymentDialog
                trigger={<Button variant="outline"><CreditCard aria-hidden /> Encaisser</Button>}
                memberId={member.id}
                subscriptions={openSubs}
                methods={(methods.data ?? []) as PaymentMethodRow[]}
                canBackdate={ctx.can("reports.financial")}
              />
            )}
          </>
        }
      />

      {archived && (
        <p className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-2 text-sm text-warning">
          <ShieldAlert className="size-4" aria-hidden /> Membre archivé le {formatDate(member.archived_at)} — {member.archive_reason}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardContent className="flex flex-col items-center gap-4 p-6 text-center">
            <MemberPhoto memberId={member.id} orgId={ctx.org.id} photoUrl={photoUrl} canEdit={ctx.can("members.write")} name={member.full_name} />
            <dl className="grid w-full gap-2 text-left text-sm">
              <InfoRow icon={Phone} label="Téléphone">{member.phone ? <a href={`tel:${member.phone}`} className="hover:underline">{member.phone}</a> : "—"}</InfoRow>
              <InfoRow icon={Mail} label="Email">{member.email ?? "—"}</InfoRow>
              <InfoRow icon={MapPin} label="Adresse">{member.address ?? "—"}</InfoRow>
              <InfoRow icon={UserRound} label="Coach">{member.coach_name ?? "Aucun"}</InfoRow>
            </dl>
            <div className="flex w-full flex-wrap justify-center gap-2 border-t pt-4">
              {ctx.can("members.write") && (
                <Button asChild size="sm" variant="outline">
                  <Link href={`/members/${member.id}/edit`}><Pencil aria-hidden /> Modifier</Link>
                </Button>
              )}
              <Button asChild size="sm" variant="outline">
                <Link href={`/members/${member.id}/card`}><QrCode aria-hidden /> Carte QR</Link>
              </Button>
              {ctx.can("members.archive") && <ArchiveMemberButton memberId={member.id} archived={archived} name={member.full_name} />}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Informations</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <Info label="Inscrit le">{formatDate(member.registered_on)}</Info>
            <Info label="Date de naissance">{formatDate(member.birth_date)}</Info>
            <Info label="Genre">{member.gender ? t.gender[member.gender] : "—"}</Info>
            <Info label="Contact d'urgence">
              {member.emergency_contact_name ? `${member.emergency_contact_name} · ${member.emergency_contact_phone ?? ""}` : "—"}
            </Info>
            {canSubs && (
              <Info label="Reste à payer">
                <span className={Number(totalDue) > 0 ? "font-semibold text-danger" : ""}>{formatMoney(totalDue)}</span>
              </Info>
            )}
            <Info label="Présences (30 derniers passages)">{attendanceRows.filter((a) => a.status === "valid").length}</Info>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue={canSubs ? "subscriptions" : canAttendance ? "attendance" : "workouts"}>
        <TabsList>
          {canSubs && <TabsTrigger value="subscriptions">Abonnements ({subscriptions.length})</TabsTrigger>}
          {canPayments && <TabsTrigger value="payments">Paiements ({paymentRows.length})</TabsTrigger>}
          {canAttendance && <TabsTrigger value="attendance">Présences</TabsTrigger>}
          <TabsTrigger value="workouts">Programmes ({programRows.length})</TabsTrigger>
          {canProgress && <TabsTrigger value="progress">Progression</TabsTrigger>}
          {canNotes && <TabsTrigger value="notes">Notes internes</TabsTrigger>}
        </TabsList>

        {canSubs && (
          <TabsContent value="subscriptions">
            {subscriptions.length === 0 ? (
              <Empty>Aucun abonnement.</Empty>
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
                        {Number(s.discount) > 0 && <p className="text-xs text-muted-foreground">Remise {formatMoney(s.discount)}</p>}
                        {s.cancel_reason && <p className="text-xs text-muted-foreground">Annulé : {s.cancel_reason}</p>}
                      </Td>
                      <Td className="whitespace-nowrap">{formatDate(s.start_date)} → {formatDate(s.end_date)}</Td>
                      <Td><SubscriptionBadge status={s.effective_status} /></Td>
                      <Td className="text-right tabular-nums">{formatMoney(s.total_due)}</Td>
                      <Td className="text-right tabular-nums">{formatMoney(s.amount_paid)}</Td>
                      <Td>{s.status === "cancelled" ? "—" : <PaymentBadge status={s.payment_status} />}</Td>
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
              <Empty>Aucun paiement.</Empty>
            ) : (
              <Table>
                <THead>
                  <tr><Th>Reçu</Th><Th>Date</Th><Th>Affectation</Th><Th>Moyen</Th><Th className="text-right">Montant</Th><Th className="text-right">Remboursé</Th><Th /></tr>
                </THead>
                <TBody>
                  {paymentRows.map((p) => (
                    <Tr key={p.id}>
                      <Td><Link href={`/payments/${p.id}/receipt`} className="font-mono text-xs hover:underline">{p.receipt_number}</Link></Td>
                      <Td className="whitespace-nowrap">{formatDateTime(p.paid_at)}</Td>
                      <Td>{p.plan_name ?? "Hors abonnement"}</Td>
                      <Td>{p.method_name}</Td>
                      <Td className="text-right tabular-nums">{formatMoney(p.amount)}</Td>
                      <Td className="text-right tabular-nums">{Number(p.refunded_amount) > 0 ? formatMoney(p.refunded_amount) : "—"}</Td>
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
              <Empty>Aucun passage enregistré.</Empty>
            ) : (
              <Table>
                <THead><tr><Th>Date</Th><Th>Entrée</Th><Th>Sortie</Th><Th>Méthode</Th><Th>Remarque</Th></tr></THead>
                <TBody>
                  {attendanceRows.map((a) => (
                    <Tr key={a.id} className={a.status === "voided" ? "opacity-50" : undefined}>
                      <Td>{formatDate(a.checked_in_at)}</Td>
                      <Td>{formatTime(a.checked_in_at)}</Td>
                      <Td>{formatTime(a.checked_out_at)}</Td>
                      <Td>{t.checkinMethod[a.method]}</Td>
                      <Td className="text-xs text-muted-foreground">
                        {a.status === "voided" ? "Annulé" : a.override_reason ? `Entrée forcée : ${a.override_reason}` : ""}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </TabsContent>
        )}

        <TabsContent value="workouts">
          {programRows.length === 0 ? (
            <Empty>Aucun programme.{ctx.can("workouts.manage_all", "workouts.manage_assigned") && <> <Link href={`/workouts?member=${member.id}`} className="underline">Créer un programme</Link></>}</Empty>
          ) : (
            <ul className="grid gap-2">
              {programRows.map((p) => (
                <li key={p.id}>
                  <Link href={`/workouts/${p.id}`} className="flex items-center justify-between rounded-lg border bg-card px-4 py-3 hover:bg-accent/50">
                    <span className="font-medium">{p.name}</span>
                    <span className="flex items-center gap-3 text-sm text-muted-foreground">
                      {p.start_date && `${formatDate(p.start_date)} → ${formatDate(p.end_date)}`}
                      <Badge variant="outline">{t.programStatus[p.status]}</Badge>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        {canProgress && (
          <TabsContent value="progress">
            {progressRows.length === 0 ? (
              <Empty>Aucune mesure. Les coachs ajoutent les mesures depuis le programme du membre.</Empty>
            ) : (
              <Table>
                <THead><tr><Th>Date</Th><Th className="text-right">Poids</Th><Th className="text-right">Masse grasse</Th><Th className="text-right">Tour de taille</Th><Th>Notes</Th></tr></THead>
                <TBody>
                  {progressRows.map((p) => (
                    <Tr key={p.id}>
                      <Td>{formatDate(p.recorded_on)}</Td>
                      <Td className="text-right tabular-nums">{p.weight_kg ? `${p.weight_kg} kg` : "—"}</Td>
                      <Td className="text-right tabular-nums">{p.body_fat_pct ? `${p.body_fat_pct} %` : "—"}</Td>
                      <Td className="text-right tabular-nums">{p.waist_cm ? `${p.waist_cm} cm` : "—"}</Td>
                      <Td className="text-xs text-muted-foreground">{p.notes}</Td>
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
  );
}

function InfoRow({ icon: Icon, label, children }: { icon: typeof Phone; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label={label} />
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p>{children}</p>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed bg-card px-4 py-8 text-center text-sm text-muted-foreground">{children}</p>;
}
