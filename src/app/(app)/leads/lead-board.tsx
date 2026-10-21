"use client";

import { startTransition, useActionState, useEffect, useMemo, useOptimistic, useState } from "react";
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
import { BellRing, CalendarClock, Phone, Plus } from "lucide-react";
import { toast } from "sonner";
import { ActionDialog } from "@/components/app/action-dialog";
import { useFormAction } from "@/components/app/use-form-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FormMessage, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime, isoToTunisLocal, todayInTunis } from "@/lib/format";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";
import { convertLead, deleteLead, moveLead, saveLead } from "./actions";

type Status = keyof typeof t.leadStatus;
const COLUMNS: Status[] = ["to_contact", "trial_scheduled", "trial_done", "won", "lost"];
const STALE_MS = 24 * 3_600_000;

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

const isStale = (l: LeadView) =>
  (l.status === "to_contact" || l.status === "trial_scheduled" || l.status === "trial_done") &&
  Date.now() - new Date(l.last_activity_at).getTime() > STALE_MS;

export function LeadBoard({ leads, coaches, canConvert }: { leads: LeadView[]; coaches: Option[]; canConvert: boolean }) {
  const [optimistic, applyMove] = useOptimistic(leads, (state, move: { id: string; status: Status }) =>
    state.map((l) => (l.id === move.id ? { ...l, status: move.status, last_activity_at: new Date().toISOString() } : l)),
  );
  const [active, setActive] = useState<LeadView | null>(null);
  const [gated, setGated] = useState<{ lead: LeadView; status: "trial_scheduled" | "lost" } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [, dispatchMove] = useActionState(async (_: unknown, fd: FormData) => {
    const res = await moveLead({}, fd);
    if (res.error) toast.error(res.error);
    return res;
  }, {});
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const byStatus = useMemo(() => Object.fromEntries(COLUMNS.map((s) => [s, optimistic.filter((l) => l.status === s)])) as Record<Status, LeadView[]>, [optimistic]);
  const opened = optimistic.find((l) => l.id === openId) ?? null;

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
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <dl className="flex flex-wrap gap-4 text-sm">
          <div><dt className="inline text-muted-foreground">En cours : </dt><dd className="inline font-semibold">{optimistic.filter((l) => ["to_contact", "trial_scheduled", "trial_done"].includes(l.status)).length}</dd></div>
          <div><dt className="inline text-muted-foreground">À relancer : </dt><dd className="inline font-semibold text-warning">{optimistic.filter(isStale).length}</dd></div>
        </dl>
        <LeadFormDialog coaches={coaches} trigger={<Button><Plus aria-hidden /> Nouveau prospect</Button>} />
      </div>

      <DndContext sensors={sensors} onDragStart={(e) => setActive(optimistic.find((l) => l.id === e.active.id) ?? null)} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
        <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-4 md:mx-0 md:px-0">
          {COLUMNS.map((status) => (
            <Column key={status} status={status} leads={byStatus[status]} onOpen={setOpenId} />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>{active ? <LeadCard lead={active} overlay /> : null}</DragOverlay>
      </DndContext>

      <TransitionDialog
        gated={gated}
        coaches={coaches}
        onClose={() => setGated(null)}
      />

      <Sheet open={!!opened} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent>
          {opened && (
            <>
              <SheetHeader>
                <SheetTitle>{opened.first_name} {opened.last_name}</SheetTitle>
                <SheetDescription asChild>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{t.leadStatus[opened.status]}</Badge>
                    <Badge variant="secondary">{t.fitnessGoal[opened.goal]}</Badge>
                    <span className="text-xs">{t.leadSource[opened.source]}</span>
                  </div>
                </SheetDescription>
              </SheetHeader>
              <div className="grid flex-1 content-start gap-4 overflow-y-auto p-6 text-sm">
                <a href={`tel:${opened.phone}`} className="flex items-center gap-2 hover:underline"><Phone className="size-4" aria-hidden /> {opened.phone}</a>
                {opened.email && <p>{opened.email}</p>}
                {opened.trial_at && <p className="flex items-center gap-2"><CalendarClock className="size-4" aria-hidden /> Essai le {formatDateTime(opened.trial_at)}</p>}
                {opened.coach && <p>Coach : {opened.coach.full_name}</p>}
                {opened.lost_reason && <p className="text-muted-foreground">Motif de perte : {opened.lost_reason}</p>}
                {opened.notes && <p className="whitespace-pre-line rounded-lg bg-muted p-3">{opened.notes}</p>}
                <div className="grid gap-2">
                  <label htmlFor="lead-stage" className="font-medium">Étape</label>
                  <NativeSelect id="lead-stage" value={opened.status} disabled={!!opened.converted_member_id} onChange={(e) => move(opened, e.target.value as Status)}>
                    {COLUMNS.map((s) => <option key={s} value={s}>{t.leadStatus[s]}</option>)}
                  </NativeSelect>
                </div>
                <div className="flex flex-wrap gap-2 border-t pt-4">
                  <LeadFormDialog coaches={coaches} lead={opened} trigger={<Button variant="outline">Modifier</Button>} />
                  {canConvert && !opened.converted_member_id && (
                    <ActionDialog trigger={<Button>Inscrire comme membre</Button>} title="Créer la fiche membre ?" description="Le prospect passe en « Gagné » ; vous pourrez ensuite lui vendre un abonnement." action={convertLead} submitLabel="Créer le membre">
                      {() => <input type="hidden" name="lead_id" value={opened.id} />}
                    </ActionDialog>
                  )}
                  {opened.converted_member_id && <Button asChild variant="outline"><a href={`/members/${opened.converted_member_id}`}>Voir la fiche membre</a></Button>}
                  <ActionDialog trigger={<Button variant="ghost" className="text-danger">Supprimer</Button>} title="Supprimer ce prospect ?" action={deleteLead} submitLabel="Supprimer" destructive>
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

function Column({ status, leads, onOpen }: { status: Status; leads: LeadView[]; onOpen: (id: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section aria-label={t.leadStatus[status]} className="flex min-w-64 flex-1 shrink-0 flex-col rounded-xl bg-muted/60">
      <header className="flex items-center justify-between px-3 py-2.5">
        <h2 className="text-sm font-semibold">{t.leadStatus[status]}</h2>
        <span className="rounded-full bg-background px-2 py-0.5 text-xs tabular-nums text-muted-foreground">{leads.length}</span>
      </header>
      <div ref={setNodeRef} className={cn("flex min-h-40 flex-1 flex-col gap-2 rounded-b-xl p-2 transition-colors", isOver && "bg-accent ring-2 ring-ring/40")}>
        {leads.map((l) => <LeadCard key={l.id} lead={l} onOpen={onOpen} />)}
        {leads.length === 0 && <p className="rounded-lg border border-dashed py-6 text-center text-xs text-muted-foreground">Déposez un prospect ici</p>}
      </div>
    </section>
  );
}

function LeadCard({ lead, onOpen, overlay }: { lead: LeadView; onOpen?: (id: string) => void; overlay?: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: lead.id, disabled: overlay });
  const stale = isStale(lead);
  return (
    <article
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => onOpen?.(lead.id)}
      aria-label={`${lead.first_name} ${lead.last_name}`}
      className={cn(
        "cursor-grab touch-none select-none rounded-lg border bg-card p-3 text-sm shadow-xs hover:border-ring/40",
        stale && "border-l-2 border-l-warning",
        isDragging && "opacity-40",
        overlay && "rotate-2 shadow-lg",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium">{lead.first_name} {lead.last_name}</p>
        <Badge variant="secondary" className="shrink-0">{t.fitnessGoal[lead.goal]}</Badge>
      </div>
      <p className="mt-1 text-muted-foreground">{lead.phone}</p>
      {lead.status === "trial_scheduled" && lead.trial_at && <p className="mt-1 text-xs text-muted-foreground">Essai : {formatDateTime(lead.trial_at)}</p>}
      {stale && <p className="mt-2 flex items-center gap-1 text-xs text-warning"><BellRing className="size-3" aria-hidden /> À relancer (+24 h)</p>}
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
              {coaches.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </NativeSelect>
          </Field>
        </>
      ) : (
        <Field label="Motif" htmlFor="lost_reason" error={state.fieldErrors?.lost_reason}>
          <NativeSelect id="lost_reason" name="lost_reason" defaultValue="Prix trop élevé">
            {["Prix trop élevé", "Horaires inadaptés", "Trop loin", "A choisi une autre salle", "Ne répond plus", "Autre"].map((r) => <option key={r}>{r}</option>)}
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

function LeadFormDialog({ coaches, lead, trigger }: { coaches: Option[]; lead?: LeadView; trigger: React.ReactNode }) {
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
