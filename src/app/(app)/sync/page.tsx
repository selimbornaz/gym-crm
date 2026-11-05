import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import { CheckCircle2, RefreshCw } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getContext, requireContext } from "@/lib/auth/context";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Synchronisation" };

const KIND_LABELS: Record<string, string> = {
  check_in: "Entrée",
  check_out: "Sortie",
  correct_attendance: "Correction de passage",
  create_subscription: "Abonnement",
  suspend_subscription: "Suspension d'abonnement",
  resume_subscription: "Reprise d'abonnement",
  cancel_subscription: "Annulation d'abonnement",
  extend_subscription: "Prolongation d'abonnement",
  record_payment: "Paiement",
  refund_payment: "Remboursement",
  book_session: "Réservation",
  cancel_booking: "Annulation de réservation",
  "row.insert": "Création",
  "row.update": "Modification",
  "row.delete": "Suppression",
};

const TABLE_LABELS: Record<string, string> = {
  members: "membre", leads: "prospect", coaches: "coach", expenses: "dépense", membership_plans: "formule",
  payment_methods: "moyen de paiement", sessions: "séance", bookings: "réservation", equipment: "équipement",
  equipment_maintenance: "entretien", member_notes: "note", workout_programs: "programme", workout_days: "séance de programme",
  workout_exercises: "exercice", workout_logs: "suivi d'entraînement", progress_entries: "mesure", announcements: "annonce",
  organizations: "salle", organization_settings: "réglages", notifications: "notification",
};

interface SyncOp {
  op_id: string;
  kind: string;
  args: { table?: string; amount?: number };
  occurred_at: string | null;
  created_at: string;
  status: "conflict" | "rejected";
  error_message: string | null;
  conflicts: Array<{ field: string; offline?: unknown; server?: unknown }> | null;
}

function describe(op: SyncOp): string {
  const kind = KIND_LABELS[op.kind] ?? op.kind;
  const table = op.args?.table ? TABLE_LABELS[op.args.table] : null;
  return table ? `${kind} : ${table}` : kind;
}

const show = (value: unknown) => (value === null || value === undefined || value === "" ? "(vide)" : String(value));

/** Marque l'action comme vue : le serveur vérifie les droits et garde la trace. */
async function markResolved(formData: FormData) {
  "use server";
  const ctx = await getContext();
  const opId = String(formData.get("op_id") ?? "");
  if (!ctx || !opId) return;
  await ctx.supabase.rpc("sync_resolve_op", { p_org: ctx.org.id, p_op: opId });
  revalidatePath("/sync");
  revalidatePath("/", "layout");
}

export default async function SyncPage() {
  const ctx = await requireContext();
  const { data, error } = await ctx.supabase
    .from("sync_ops")
    .select("op_id, kind, args, occurred_at, created_at, status, error_message, conflicts")
    .eq("organization_id", ctx.org.id)
    .in("status", ["conflict", "rejected"])
    .is("resolved_at", null)
    .order("created_at", { ascending: false })
    .limit(200);
  const ops = (data ?? []) as SyncOp[];

  let pending: Array<{ opId: string; label: string; occurredAt: string }> = [];
  if (process.env.NEXT_PUBLIC_CASTLE_DESKTOP === "1") {
    const { pendingOps } = await import("@/lib/offline/store");
    pending = pendingOps(ctx.user.id).filter((op) => op.org === ctx.org.id);
  }

  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      <PageHeader
        title="Synchronisation"
        description="Actions faites sans Internet : en attente d'envoi, ou que le serveur n'a pas pu appliquer entièrement."
      />

      {pending.length > 0 && (
        <section className="grid gap-2" aria-label="Actions en attente">
          <h2 className="text-sm font-semibold">En attente d&apos;envoi ({pending.length})</h2>
          <Card>
            <CardContent className="grid gap-2 pt-5 text-sm">
              {pending.map((op) => (
                <p key={op.opId} className="flex justify-between gap-4">
                  <span>{KIND_LABELS[op.label] ?? op.label}</span>
                  <span className="shrink-0 text-muted-foreground">{formatDateTime(op.occurredAt)}</span>
                </p>
              ))}
              <p className="mt-1 text-xs text-muted-foreground">Elles partiront toutes seules au retour d&apos;Internet.</p>
            </CardContent>
          </Card>
        </section>
      )}

      <section className="grid gap-3" aria-label="Actions à vérifier">
        {error ? (
          <p className="text-sm text-muted-foreground">Liste indisponible pour le moment.</p>
        ) : ops.length === 0 ? (
          pending.length === 0 && <EmptyState icon={CheckCircle2} title="Tout est à jour" description="Aucune action à vérifier." />
        ) : (
          <>
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <RefreshCw className="size-4" aria-hidden /> À vérifier ({ops.length})
            </h2>
            {ops.map((op) => (
              <Card key={op.op_id}>
                <CardContent className="grid gap-3 pt-5 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{describe(op)}</p>
                    <Badge variant={op.status === "rejected" ? "danger" : "warning"} dot>
                      {op.status === "rejected" ? "Refusée" : "Conflit"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">Faite le {formatDateTime(op.occurred_at ?? op.created_at)}</p>
                  {op.status === "rejected" && <p>{op.error_message ?? "Refusée par le serveur."}</p>}
                  {op.status === "conflict" && (
                    <div className="grid gap-1">
                      <p>Modifié ailleurs entre-temps : la valeur la plus récente a été gardée.</p>
                      {(op.conflicts ?? []).map((c) => (
                        <p key={c.field} className="text-xs text-muted-foreground">
                          {c.field === "*" ? "Élément modifié ailleurs : il n'a pas été supprimé." : `${c.field} : gardé « ${show(c.server)} », hors ligne « ${show(c.offline)} »`}
                        </p>
                      ))}
                    </div>
                  )}
                  <form action={markResolved}>
                    <input type="hidden" name="op_id" value={op.op_id} />
                    <Button type="submit" variant="outline" size="sm">Marquer comme traité</Button>
                  </form>
                </CardContent>
              </Card>
            ))}
          </>
        )}
      </section>
    </div>
  );
}
