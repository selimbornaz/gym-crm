import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionState } from "@/lib/action-state";
import { createAdminClient } from "@/lib/supabase/admin";
import { deliver, handleIncoming } from "./inbound";
import type { ChatConversation } from "./types";

/**
 * Opérations du chatbot qui ont besoin des secrets du serveur (clé service
 * Supabase, clé Anthropic). Elles tournent toujours sur le site web : l'application
 * de bureau, qui ne contient aucun secret, les lui délègue (voir remote.ts).
 * L'appelant a déjà vérifié la session et la permission.
 */
export interface ChatActor {
  /** Client Supabase de l'utilisateur (soumis à la RLS). */
  db: SupabaseClient;
  userId: string;
  fullName: string;
  orgId: string;
}

export const simulatorSenderId = (userId: string) => `simulateur-${userId}`;

/** Réponse d'un employé : envoyée au client, enregistrée en son nom, bot en pause. */
export async function staffReplyCore(actor: ChatActor, conversationId: string, body: string): Promise<ActionState> {
  const { db, orgId, userId } = actor;
  const { data: conv } = await db.from("chat_conversations").select("*").eq("organization_id", orgId).eq("id", conversationId).maybeSingle();
  if (!conv) return { error: "Conversation introuvable." };
  const conversation = conv as ChatConversation;

  const { data: settings } = await db.from("chatbot_settings").select("human_pause_minutes").eq("organization_id", orgId).maybeSingle();
  const pause = (settings?.human_pause_minutes as number | undefined) ?? 120;

  const admin = createAdminClient();
  // Envoi d'abord (le jeton n'est lisible que côté serveur), puis enregistrement.
  const sent = await deliver(admin, conversation, null, body);
  const { error } = await db.from("chat_messages").insert({
    organization_id: orgId,
    conversation_id: conversationId,
    sender: "staff",
    body,
    staff_user_id: userId,
    external_id: sent.externalId,
    delivery_error: sent.error,
  });
  if (error) return { error: "Message non enregistré : réessayez." };

  await db
    .from("chat_conversations")
    .update({
      status: "human",
      needs_human: false,
      unread_count: 0,
      bot_paused_until: new Date(Date.now() + pause * 60_000).toISOString(),
      last_message_at: new Date().toISOString(),
      last_message_preview: body.slice(0, 140),
    })
    .eq("organization_id", orgId)
    .eq("id", conversationId);
  await admin.from("chat_events").insert({ organization_id: orgId, conversation_id: conversationId, channel: conversation.channel, kind: "staff_reply" });

  if (sent.error) return { error: `Message enregistré mais non délivré : ${sent.error}` };
  return { ok: true };
}

/** Simulateur : parle au bot exactement comme un client, sans compte Meta. */
export async function simulatorSendCore(actor: ChatActor, body: string, phone: string | null): Promise<ActionState> {
  const admin = createAdminClient();
  const senderId = simulatorSenderId(actor.userId);
  // Le numéro testé peut changer d'un essai à l'autre : on le met à jour.
  await admin
    .from("chat_conversations")
    .update({ contact_phone: phone })
    .eq("organization_id", actor.orgId)
    .eq("channel", "simulator")
    .eq("external_user_id", senderId);
  const r = await handleIncoming(admin, {
    organizationId: actor.orgId,
    channel: "simulator",
    accountId: null,
    accountExternalId: null,
    senderId,
    senderName: `Test · ${actor.fullName}`,
    senderPhone: phone,
    messageId: null,
    text: body,
    isText: true,
  });
  // Dans le simulateur, une panne de l'IA est affichée telle quelle (clé absente, quota…).
  if (r.error) return { error: `Le bot n'a pas pu répondre : ${r.error}` };
  return { ok: true };
}

/** Efface la conversation de test de l'utilisateur. */
export async function simulatorResetCore(actor: ChatActor): Promise<ActionState> {
  const { error } = await createAdminClient()
    .from("chat_conversations")
    .delete()
    .eq("organization_id", actor.orgId)
    .eq("channel", "simulator")
    .eq("external_user_id", simulatorSenderId(actor.userId));
  if (error) return { error: "Réinitialisation impossible : réessayez." };
  return { ok: true };
}
