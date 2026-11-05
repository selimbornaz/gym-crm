import "server-only";
import { deviceId, dropQueuedOp, getMeta, pendingCount, pendingOps, saveDevice, type QueuedOp } from "./store";
import { pullAll, type RemoteClient, type SyncSummary } from "./sync";

/**
 * Envoi de la file au retour d'Internet, dans l'ordre, une opération à la fois.
 * Un refus du serveur est définitif et conservé côté serveur pour revue : la file
 * continue. Une panne réseau arrête tout sans rien perdre : le serveur reconnaît
 * une opération déjà reçue et renvoie son premier résultat.
 */
interface OpResult {
  status: "applied" | "conflict" | "rejected";
  result: Record<string, unknown> | null;
}

export interface PushSummary {
  sent: number;
  applied: number;
  conflicts: number;
  rejected: number;
  remaining: number;
  /** Salles dont des opérations ont été traitées : leur copie doit être relue en entier. */
  touchedOrgs: string[];
  error: string | null;
}

/** Enregistre le poste pour chaque salle : attribue sa série permanente de numéros. */
export async function registerDevice(client: RemoteClient, orgs: string[], name: string): Promise<void> {
  for (const org of orgs) {
    const { data, error } = await client.rpc("sync_register_device", { p_org: org, p_device: deviceId(), p_name: name });
    if (error) throw new Error(`Enregistrement du poste : ${error.message}`);
    const d = data as { series: string; member_code_prefix: string; receipt_prefix: string };
    saveDevice(org, { series: d.series, memberPrefix: d.member_code_prefix, receiptPrefix: d.receipt_prefix });
  }
}

/** Remplace les identifiants provisoires par ceux attribués par le serveur. */
function remap(value: unknown, ids: Record<string, string>): unknown {
  if (typeof value === "string") return ids[value] ?? value;
  if (Array.isArray(value)) return value.map((v) => remap(v, ids));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remap(v, ids)]));
  }
  return value;
}

function learnedIds(op: QueuedOp, result: Record<string, unknown> | null, ids: Record<string, string>) {
  if (op.kind === "book_session" && result?.booking_id && op.args.local_id) {
    ids[String(op.args.local_id)] = String(result.booking_id);
  }
  // Passage déjà enregistré sur un autre poste : l'identifiant du serveur fait foi.
  if (op.kind === "check_in" && result?.attendance_id && op.args.row_id) {
    ids[String(op.args.row_id)] = String(result.attendance_id);
  }
}

export async function pushQueue(client: RemoteClient, user: string): Promise<PushSummary> {
  const summary: PushSummary = { sent: 0, applied: 0, conflicts: 0, rejected: 0, remaining: 0, touchedOrgs: [], error: null };
  const queue = pendingOps(user);
  const touched = new Set<string>();
  const ids = JSON.parse(getMeta(user, "queue_ids") ?? "{}") as Record<string, string>;

  for (const op of queue) {
    const { local_id: _localId, ...args } = op.args;
    const { data, error } = await client.rpc("sync_apply_op", {
      p_org: op.org, p_device: deviceId(), p_op_id: op.opId, p_kind: op.kind,
      p_args: remap(args, ids), p_occurred_at: op.occurredAt,
    });
    if (error) {
      // Réseau, session expirée, poste révoqué : rien n'est perdu, on réessaiera.
      summary.error = error.message;
      summary.remaining = queue.length - summary.sent;
      break;
    }
    const outcome = data as OpResult;
    learnedIds(op, outcome.result, ids);
    summary.sent++;
    if (outcome.status === "applied") summary.applied++;
    else if (outcome.status === "conflict") summary.conflicts++;
    else summary.rejected++;
    touched.add(op.org);
    dropQueuedOp(user, op.seq!, { queue_ids: JSON.stringify(ids) });
  }
  summary.touchedOrgs = [...touched];
  return summary;
}

export type SyncOutcome =
  | { status: "pending"; pushed: PushSummary }
  | ({ status: "ok"; pushed: PushSummary } & SyncSummary);

/**
 * Un cycle complet : envoi d'abord, téléchargement ensuite. Tant qu'il reste des
 * actions à envoyer, rien n'écrase leur effet visible sur le poste. Après un envoi,
 * la copie repart de la vérité du serveur, refus et conflits compris.
 */
export async function syncAll(client: RemoteClient, user: string, orgs: string[], pushed?: PushSummary): Promise<SyncOutcome> {
  const sent = pushed ?? (await pushQueue(client, user));
  await registerDevice(client, orgs, "Castle CRM");
  if (pendingCount(user) > 0) return { status: "pending", pushed: sent };
  return { status: "ok", pushed: sent, ...(await pullAll(client, user, orgs, sent.touchedOrgs)) };
}
