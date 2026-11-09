import "server-only";
import type { ActionState } from "@/lib/action-state";
import type { AppContext } from "@/lib/auth/context";
import { publicEnv } from "@/lib/env";
import type { Permission } from "@/lib/permissions";
import type { StaffRole } from "@/lib/permissions";
import { createStaffCore, resetStaffPasswordCore } from "@/lib/staff/service";
import { simulatorResetCore, simulatorSendCore, staffReplyCore, type ChatActor } from "./service";

/**
 * Opérations qui ont besoin des secrets du serveur (chatbot, comptes du
 * personnel). L'application de bureau n'en embarque aucun : elle les fait
 * exécuter par le site web via /api/chatbot/remote.
 */
export type ChatOp =
  | { op: "staff_reply"; conversationId: string; body: string }
  | { op: "simulator_send"; body: string; phone: string | null }
  | { op: "simulator_reset" }
  | { op: "staff_create"; fullName: string; email: string; password: string; role: StaffRole; jobTitle: string | null; createCoach: boolean }
  | { op: "staff_password"; staffId: string; password: string };

export const OP_PERMISSION: Record<ChatOp["op"], Permission> = {
  staff_reply: "chatbot.inbox",
  simulator_send: "chatbot.manage",
  simulator_reset: "chatbot.manage",
  staff_create: "staff.manage",
  staff_password: "staff.manage",
};

export function runChatOpLocally(actor: ChatActor, op: ChatOp): Promise<ActionState> {
  switch (op.op) {
    case "staff_reply":
      return staffReplyCore(actor, op.conversationId, op.body);
    case "simulator_send":
      return simulatorSendCore(actor, op.body, op.phone);
    case "simulator_reset":
      return simulatorResetCore(actor);
    case "staff_create": {
      const { op: _op, ...input } = op;
      return createStaffCore({ userId: actor.userId, orgId: actor.orgId }, input);
    }
    case "staff_password":
      return resetStaffPasswordCore({ userId: actor.userId, orgId: actor.orgId }, op.staffId, op.password);
  }
}

const IS_DESKTOP = process.env.NEXT_PUBLIC_CASTLE_DESKTOP === "1";

/**
 * Exécute une opération du chatbot. Sur le site web : directement. Dans
 * l'application de bureau (aucun secret embarqué) : le site web l'exécute, avec
 * la session de l'utilisateur, qu'il vérifie lui-même (/api/chatbot/remote).
 */
export async function runChatOp(ctx: AppContext, op: ChatOp): Promise<ActionState> {
  if (!IS_DESKTOP) {
    return runChatOpLocally({ db: ctx.supabase, userId: ctx.user.id, fullName: ctx.fullName, orgId: ctx.org.id }, op);
  }

  // Hors ligne, le client local n'a pas de session Supabase : le chatbot exige Internet.
  const auth = ctx.supabase.auth as Partial<Pick<typeof ctx.supabase.auth, "getSession">>;
  const session = typeof auth.getSession === "function" ? (await auth.getSession()).data.session : null;
  if (!session?.access_token) return { error: "Le chatbot a besoin d'une connexion Internet." };

  const site = publicEnv.siteUrl.replace(/\/$/, "");
  if (!/^https:\/\//.test(site)) return { error: "Adresse du site web non configurée pour le chatbot." };
  try {
    const res = await fetch(`${site}/api/chatbot/remote`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ orgId: ctx.org.id, ...op }),
      cache: "no-store",
      signal: AbortSignal.timeout(90_000),
    });
    const data = (await res.json().catch(() => null)) as ActionState | null;
    if (!data) return { error: `Le site web a répondu ${res.status} : réessayez.` };
    return data;
  } catch {
    return { error: "Site web injoignable : vérifiez la connexion Internet." };
  }
}
