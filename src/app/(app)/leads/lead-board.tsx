"use client";

import { startTransition, useActionState, useEffect, useId, useMemo, useOptimistic, useState, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { BellRing, CalendarClock, Clock3, GripVertical, Phone, Plus, Target, UserRoundCheck } from "lucide-react";
import { toast } from "sonner";
import { ActionDialog } from "@/components/app/action-dialog";
import { useFormAction } from "@/components/app/use-form-action";
import { AvatarStack, InitialsAvatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FormMessage, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime, formatRelative, isoToTunisLocal, todayInTunis } from "@/lib/format";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";
import { convertLead, deleteLead, moveLead, saveLead } from "./actions";

type Status = keyof typeof t.leadStatus;
const COLUMNS: Status[] = ["to_contact", "trial_scheduled", "trial_done", "won", "lost"];
const STALE_MS = 24 * 3_600_000;

/** Pastille de colonne : teinte discrète par étape (la couleur double un libellé). */
const STAGE_DOT: Record<Status, string> = {
  to_contact: "bg-zinc-400",
  trial_scheduled: "bg-indigo-500",
  trial_done: "bg-sky-500",
  won: "bg-emerald-500",
  lost: "bg-rose-500/70",
};

export interface LeadView {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string | null;
  goal: keyof typeof t.fitnessGoal;
  source: keyof typeof t.leadSource;
  status: Status;
  notes: string | null;
  trial_at: string | null;
  coach_id: string | null;
  lost_reason: string | null;
  converted_member_id: string | null;
  last_activity_at: string;
  coach: { full_name: string } | null;
}

type Option = { id: string; label: string };

const fullName = (l: LeadView) => `${l.first_name} ${l.last_name}`;
const isStale = (l: LeadView) =>
  (l.status === "to_contact" || l.status === "trial_scheduled" || l.status === "trial_done") &&
  Date.now() - new Date(l.last_activity_at).getTime() > STALE_MS;

export function LeadBoard({ leads, coaches, canConvert }: { leads: LeadView[]; coaches: Option[]; canConvert: boolean }) {
  const [optimistic, applyMove] = useOptimistic(leads, (state, move: { id: string; status: Status }) =>
    state.map((l) => (l.id === move.id ? { ...l, status: move.status, last_activity_at: new Date().toISOString() } : l)),
  );
  // Identifiant stable SSR/navigateur pour les attributs ARIA générés par dnd-kit.
  const dndId = useId();
  const [active, setActive] = useState<LeadView | null>(null);
  const [gated, setGated] = useState<{ lead: LeadView; status: "trial_scheduled" | "lost" } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [, dispatchMove] = useActionState(async (_: unknown, fd: FormData) => {
    const res = await moveLead({}, fd);
    if (res.error) toast.error(res.error);
    return res;
  }, {});
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const byStatus = useMemo(
    () => Object.fromEntries(COLUMNS.map((s) => [s, optimistic.filter((l) => l.status === s)])) as Record<Status, LeadView[]>,
    [optimistic],
  );
  const opened = optimistic.find((l) => l.id === openId) ?? null;
  const openCount = optimistic.filter((l) => ["to_contact", "trial_scheduled", "trial_done"].includes(l.status)).length;
  const staleCount = optimistic.filter(isStale).length;
  const won = byStatus.won.length;
  const closed = won + byStatus.lost.length;

  function move(lead: LeadView, status: Status) {
    if (lead.status === status) return;
    if (lead.converted_member_id) return void toast.error("Prospect déjà converti en membre.");
    if (status === "trial_scheduled" || status === "lost") return setGated({ lead, status });
    const fd = new FormData();
    fd.set("lead_id", lead.id);
    fd.set("status", status);
    startTransition(() => {
      applyMove({ id: lead.id, status });
      dispatchMove(fd);
    });
  }

  function onDragEnd({ active: a, over }: DragEndEvent) {
    setActive(null);
    const lead = optimistic.find((l) => l.id === a.id);
    if (lead && over && COLUMNS.includes(over.id as Status)) move(lead, over.id as Status);
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Barre de synthèse ------------------------------------------------------ */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <dl className="flex flex-wrap items-center gap-2">
          <Metric label="En cours" value={openCount} />
          <Metric label="À relancer" value={staleCount} tone={staleCount > 0 ? "warning" : undefined} icon={<BellRing className="size-3" strokeWidth={2} aria-hidden />} />
          <Metric label="Taux de gain" value={closed === 0 ? "—" : `${Math.round((won / closed) * 100)} %`} />
        </dl>
        <LeadFormDialog coaches={coaches} trigger={<Button><Plus aria-hidden /> Nouveau prospect</Button>} />
      </div>

      {/* Colonnes ---------------------------------------------------------------- */}
      <DndContext
        id={dndId}
        sensors={sensors}
        onDragStart={(e) => setActive(optimistic.find((l) => l.id === e.active.id) ?? null)}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActive(null)}
        accessibility={{
          screenReaderInstructions: {
            draggable: "Appuyez sur Espace pour saisir le prospect, flèches pour changer de colonne, Espace pour déposer.",
          },
        }}
      >
        <div className="-mx-4 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0">
          <div className="flex min-w-max divide-x divide-border/80 rounded-2xl border bg-card/40 md:min-w-0">
            {COLUMNS.map((status) => (
              <Column key={status} status={status} leads={byStatus[status]} onOpen={setOpenId} dragging={!!active} />
            ))}
          </div>
        </div>
        <DragOverlay dropAnimation={{ duration: 220, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }}>
          {active ? <LeadCard lead={active} overlay /> : null}
        </DragOverlay>
      </DndContext>

      <TransitionDialog gated={gated} coaches={coaches} onClose={() => setGated(null)} />

      {/* Fiche prospect ---------------------------------------------------------- */}
      <Sheet open={!!opened} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent>
          {opened && (
            <>
              <SheetHeader>
                <div className="flex items-center gap-3">
                  <InitialsAvatar name={fullName(opened)} className="size-10 text-xs" />
                  <div className="min-w-0">
                    <SheetTitle className="truncate">{fullName(opened)}</SheetTitle>
                    <SheetDescription asChild>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline">
                          <span className={cn("size-1.5 rounded-full", STAGE_DOT[opened.status])} aria-hidden />
                          {t.leadStatus[opened.status]}
                        </Badge>
                        <Badge variant="secondary">{t.fitnessGoal[opened.goal]}</Badge>
                        <span className="text-[11px] text-subtle-foreground">{t.leadSource[opened.source]}</span>
                      </div>
                    </SheetDescription>
                  </div>
                </div>
              </SheetHeader>
              <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-6 text-[13px]">
                <dl className="grid gap-2.5">
                  <MetaRow icon={Phone} label="Téléphone">
                    <a href={`tel:${opened.phone}`} className="transition-colors duration-300 ease-out hover:text-foreground hover:underline">
                      {opened.phone}
                    </a>
                  </MetaRow>
                  {opened.trial_at && <MetaRow icon={CalendarClock} label="Essai">{formatDateTime(opened.trial_at)}</MetaRow>}
                  <MetaRow icon={UserRoundCheck} label="Coach">{opened.coach?.full_name ?? "Non assigné"}</MetaRow>
                  <MetaRow icon={Clock3} label="Dernière activité">{formatRelative(opened.last_activity_at)}</MetaRow>
                  {opened.lost_reason && <MetaRow icon={Target} label="Motif de perte">{opened.lost_reason}</MetaRow>}
                </dl>
                {opened.notes && <p className="whitespace-pre-line rounded-lg border bg-secondary/50 p-3 text-muted-foreground">{opened.notes}</p>}
                <div className="grid gap-1.5">
                  <label htmlFor="lead-stage" className="text-eyebrow">Étape</label>
                  <NativeSelect id="lead-stage" value={opened.status} disabled={!!opened.converted_member_id} onChange={(e) => move(opened, e.target.value as Status)}>
                    {COLUMNS.map((s) => (
                      <option key={s} value={s}>{t.leadStatus[s]}</option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="mt-auto flex flex-wrap gap-2 border-t pt-4">
                  <LeadFormDialog coaches={coaches} lead={opened} trigger={<Button variant="outline">Modifier</Button>} />
                  {canConvert && !opened.converted_member_id && (
                    <ActionDialog
                      trigger={<Button>Inscrire comme membre</Button>}
                      title="Créer la fiche membre ?"
                      description="Le prospect passe en « Gagné » ; vous pourrez ensuite lui vendre un abonnement."
                      action={convertLead}
                      submitLabel="Créer le membre"
                    >
                      {() => <input type="hidden" name="lead_id" value={opened.id} />}
                    </ActionDialog>
                  )}
                  {opened.converted_member_id && (
                    <Button asChild variant="outline">
                      <a href={`/members/${opened.converted_member_id}`}>Voir la fiche membre</a>
                    </Button>
                  )}
                  <ActionDialog trigger={<Button variant="ghost" className="text-danger hover:text-danger">Supprimer</Button>} title="Supprimer ce prospect ?" action={deleteLead} submitLabel="Supprimer" destructive>
                    {() => <input type="hidden" name="lead_id" value={opened.id} />}
                  </ActionDialog>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Metric({ label, value, tone, icon }: { label: string; value: number | string; tone?: "warning"; icon?: ReactNode }) {
  return (
    <div
      className={cn(
        "edge-highlight flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5 shadow-card transition-all duration-300 ease-out",
        tone === "warning" && "border-amber-500/25 bg-amber-500/[0.06]",
      )}
    >
      <dt className={cn("flex items-center gap-1 text-[11px] text-muted-foreground", tone === "warning" && "text-amber-700 dark:text-amber-400")}>
        {icon}
        {label}
      </dt>
      <dd className="text-[13px] font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function MetaRow({ icon: Icon, label, children }: { icon: typeof Phone; label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <dt className="flex w-36 shrink-0 items-center gap-2 text-muted-foreground">
        <Icon className="size-3.5 text-subtle-foreground" strokeWidth={1.75} aria-hidden />
        {label}
      </dt>
      <dd className="min-w-0 truncate text-foreground">{children}</dd>
    </div>
  );
}

function Column({ status, leads, onOpen, dragging }: { status: Status; leads: LeadView[]; onOpen: (id: string) => void; dragging: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section aria-label={t.leadStatus[status]} className="flex w-[17.5rem] shrink-0 flex-col md:w-auto md:min-w-0 md:flex-1">
      <header className="flex h-12 items-center gap-2 px-4">
        <span className={cn("size-2 rounded-full ring-4 ring-current/10", STAGE_DOT[status])} aria-hidden />
        <h2 className="text-[13px] font-medium tracking-[-0.01em]">{t.leadStatus[status]}</h2>
        <span className="rounded-md bg-secondary px-1.5 text-[11px] font-medium tabular-nums leading-5 text-muted-foreground">{leads.length}</span>
        <span className="ml-auto">
          <AvatarStack names={leads.map(fullName)} max={3} size="size-5" label={`${leads.length} prospects`} />
        </span>
      </header>
      <div
        ref={setNodeRef}
        className={cn(
          "mx-2 mb-2 flex min-h-56 flex-1 flex-col gap-2 rounded-xl p-1.5 transition-all duration-300 ease-out",
          dragging && "bg-secondary/30",
          isOver && "bg-indigo-500/[0.06] ring-1 ring-inset ring-indigo-500/30",
        )}
      >
        {leads.map((l) => (
          <LeadCard key={l.id} lead={l} onOpen={onOpen} />
        ))}
        {leads.length === 0 && (
          <p className={cn("flex flex-1 items-center justify-center rounded-lg border border-dashed py-8 text-[11px] text-subtle-foreground transition-colors duration-300 ease-out", isOver && "border-indigo-500/40 text-indigo-600 dark:text-indigo-300")}>
            Déposez un prospect ici
          </p>
        )}
      </div>
    </section>
  );
}

function LeadCard({ lead, onOpen, overlay }: { lead: LeadView; onOpen?: (id: string) => void; overlay?: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: lead.id, disabled: overlay });
  const stale = isStale(lead);
  const people = [fullName(lead), ...(lead.coach ? [lead.coach.full_name] : [])];

  return (
    <article
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => onOpen?.(lead.id)}
      aria-label={fullName(lead)}
      data-active={overlay ? "true" : undefined}
      className={cn(
        "gradient-border edge-highlight group relative cursor-grab touch-none select-none rounded-xl border bg-card p-3 shadow-card",
        "transition-all duration-300 ease-out hover:-translate-y-px hover:shadow-card-hover",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        isDragging && "opacity-30",
        overlay && "rotate-[1.5deg] cursor-grabbing shadow-float",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium tracking-[-0.01em]">{fullName(lead)}</p>
          <p className="mt-0.5 truncate text-[11px] text-subtle-foreground">{t.fitnessGoal[lead.goal]} · {t.leadSource[lead.source]}</p>
        </div>
        <GripVertical className="mt-0.5 size-3.5 shrink-0 text-subtle-foreground opacity-0 transition-opacity duration-300 ease-out group-hover:opacity-100" strokeWidth={1.75} aria-hidden />
      </div>

      <dl className="mt-3 grid gap-1.5 text-[12px] text-muted-foreground">
        <div className="flex items-center gap-2">
          <Phone className="size-3.5 text-subtle-foreground" strokeWidth={1.5} aria-label="Téléphone" />
          <a
            href={`tel:${lead.phone}`}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className="truncate tabular-nums transition-colors duration-300 ease-out hover:text-foreground"
          >
            {lead.phone}
          </a>
        </div>
        {lead.status === "trial_scheduled" && lead.trial_at && (
          <div className="flex items-center gap-2">
            <CalendarClock className="size-3.5 text-indigo-500" strokeWidth={1.5} aria-label="Essai" />
            <span className="truncate">Essai {formatDateTime(lead.trial_at)}</span>
          </div>
        )}
        {lead.status === "lost" && lead.lost_reason && (
          <div className="flex items-center gap-2">
            <Target className="size-3.5 text-subtle-foreground" strokeWidth={1.5} aria-label="Motif" />
            <span className="truncate">{lead.lost_reason}</span>
          </div>
        )}
      </dl>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/70 pt-2.5">
        <AvatarStack names={people} max={2} size="size-5" label={lead.coach ? `Coach : ${lead.coach.full_name}` : "Aucun coach assigné"} />
        {stale ? (
          <Badge variant="warning" className="gap-1">
            <BellRing className="size-3" strokeWidth={2} aria-hidden /> Relance due
          </Badge>
        ) : (
          <span className="flex items-center gap-1 text-[11px] text-subtle-foreground" suppressHydrationWarning>
            <Clock3 className="size-3" strokeWidth={1.75} aria-hidden />
            {formatRelative(lead.last_activity_at)}
          </span>
        )}
      </div>
    </article>
  );
}

/** Dialogue contrôlé : date + coach pour un essai, motif pour une perte. */
function TransitionDialog({
  gated,
  coaches,
  onClose,
}: {
  gated: { lead: LeadView; status: "trial_scheduled" | "lost" } | null;
  coaches: Option[];
  onClose: () => void;
}) {
  return (
    <Dialog open={!!gated} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>{gated && <TransitionForm key={gated.lead.id + gated.status} gated={gated} coaches={coaches} onClose={onClose} />}</DialogContent>
    </Dialog>
  );
}

function TransitionForm({ gated, coaches, onClose }: { gated: { lead: LeadView; status: "trial_scheduled" | "lost" }; coaches: Option[]; onClose: () => void }) {
  const { state, onSubmit, pending } = useFormAction(moveLead);
  useEffect(() => {
    if (state.ok) onClose();
  }, [state, onClose]);
  const tomorrow = `${todayInTunis(new Date(Date.now() + 86_400_000))}T18:00`;
  const trial = gated.status === "trial_scheduled";

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{trial ? `Planifier l'essai de ${gated.lead.first_name}` : `Marquer ${gated.lead.first_name} comme perdu`}</DialogTitle>
      </DialogHeader>
      <input type="hidden" name="lead_id" value={gated.lead.id} />
      <input type="hidden" name="status" value={gated.status} />
      {trial ? (
        <>
          <Field label="Date et heure" htmlFor="trial_at" error={state.fieldErrors?.trial_at} required>
            <Input id="trial_at" name="trial_at" type="datetime-local" defaultValue={gated.lead.trial_at ? isoToTunisLocal(gated.lead.trial_at) : tomorrow} />
          </Field>
          <Field label="Coach" htmlFor="trial_coach">
            <NativeSelect id="trial_coach" name="coach_id" defaultValue={gated.lead.coach_id ?? ""}>
              <option value="">Non assigné</option>
              {coaches.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </NativeSelect>
          </Field>
        </>
      ) : (
        <Field label="Motif" htmlFor="lost_reason" error={state.fieldErrors?.lost_reason}>
          <NativeSelect id="lost_reason" name="lost_reason" defaultValue="Prix trop élevé">
            {["Prix trop élevé", "Horaires inadaptés", "Trop loin", "A choisi une autre salle", "Ne répond plus", "Autre"].map((r) => (
              <option key={r}>{r}</option>
            ))}
          </NativeSelect>
        </Field>
      )}
      <FormMessage state={{ error: state.error }} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Annuler</Button>
        <SubmitButton pending={pending} variant={trial ? "default" : "destructive"}>{trial ? "Planifier" : "Confirmer"}</SubmitButton>
      </DialogFooter>
    </form>
  );
}

function LeadFormDialog({ coaches, lead, trigger }: { coaches: Option[]; lead?: LeadView; trigger: ReactNode }) {
  return (
    <ActionDialog trigger={trigger} title={lead ? "Modifier le prospect" : "Nouveau prospect"} action={saveLead} wide>
      {(state) => {
        const e = state.fieldErrors ?? {};
        return (
          <>
            {lead && <input type="hidden" name="lead_id" value={lead.id} />}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Prénom" htmlFor="lead_first" error={e.first_name} required><Input id="lead_first" name="first_name" defaultValue={lead?.first_name} /></Field>
              <Field label="Nom" htmlFor="lead_last" error={e.last_name} required><Input id="lead_last" name="last_name" defaultValue={lead?.last_name} /></Field>
              <Field label="Téléphone" htmlFor="lead_phone" error={e.phone} required><Input id="lead_phone" name="phone" type="tel" defaultValue={lead?.phone} /></Field>
              <Field label="Email" htmlFor="lead_email" error={e.email}><Input id="lead_email" name="email" type="email" defaultValue={lead?.email ?? ""} /></Field>
              <Field label="Objectif" htmlFor="lead_goal" error={e.goal}>
                <NativeSelect id="lead_goal" name="goal" defaultValue={lead?.goal ?? "other"}>
                  {Object.entries(t.fitnessGoal).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Source" htmlFor="lead_source" error={e.source}>
                <NativeSelect id="lead_source" name="source" defaultValue={lead?.source ?? "walk_in"}>
                  {Object.entries(t.leadSource).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Coach référent" htmlFor="lead_coach">
                <NativeSelect id="lead_coach" name="coach_id" defaultValue={lead?.coach_id ?? ""}>
                  <option value="">Non assigné</option>
                  {coaches.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </NativeSelect>
              </Field>
            </div>
            <Field label="Notes" htmlFor="lead_notes" error={e.notes}><Textarea id="lead_notes" name="notes" rows={3} defaultValue={lead?.notes ?? ""} /></Field>
          </>
        );
      }}
    </ActionDialog>
  );
}
