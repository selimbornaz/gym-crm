import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateBotReply } from "./engine";
import { sendMetaText } from "./meta";
import { DEFAULT_SETTINGS, type ChatChannel, type ChatConversation, type ChatbotSettings } from "./types";

export interface IncomingChat {
  organizationId: string;
  channel: ChatChannel;
  accountId: string | null;
  /** Identifiant du compte de la salle chez Meta (pour l'envoi). */
  accountExternalId: string | null;
  senderId: string;
  senderName: string | null;
  senderPhone: string | null;
  messageId: string | null;
  text: string;
  isText: boolean;
}

export async function loadSettings(admin: SupabaseClient, org: string): Promise<ChatbotSettings> {
  const { data } = await admin.from("chatbot_settings").select("*").eq("organization_id", org).maybeSingle();
  return { organization_id: org, ...DEFAULT_SETTINGS, ...(data ?? {}) } as ChatbotSettings;
}

async function logEvents(admin: SupabaseClient, conversation: ChatConversation, events: Array<{ kind: string; details?: Record<string, unknown> }>) {
  if (!events.length) return;
  await admin.from("chat_events").insert(
    events.map((e) => ({
      organization_id: conversation.organization_id,
      conversation_id: conversation.id,
      channel: conversation.channel,
      kind: e.kind,
      details: e.details ?? null,
    })),
  );
}

/**
 * Traite un message entrant : enregistrement (sans doublon), puis réponse du bot
 * si la conversation n'est pas reprise par l'équipe. Retourne la réponse envoyée.
 */
export async function handleIncoming(admin: SupabaseClient, msg: IncomingChat): Promise<{ reply: string | null; conversationId: string }> {
  const org = msg.organizationId;
  const settings = await loadSettings(admin, org);
  const now = new Date().toISOString();
  const preview = msg.text.slice(0, 140);

  // Conversation : créée au premier message, puis mise à jour.
  let { data: existing } = await admin
    .from("chat_conversations")
    .select("*")
    .eq("organization_id", org)
    .eq("channel", msg.channel)
    .eq("external_user_id", msg.senderId)
    .maybeSingle();
  const isNew = !existing;
  if (!existing) {
    const { data, error } = await admin
      .from("chat_conversations")
      .insert({
        organization_id: org,
        channel: msg.channel,
        account_id: msg.accountId,
        external_user_id: msg.senderId,
        contact_name: msg.senderName,
        contact_phone: msg.senderPhone,
        last_message_at: now,
        last_message_preview: preview,
        last_inbound_at: now,
      })
      .select("*")
      .single();
    if (error) throw new Error(`Conversation : ${error.message}`);
    existing = data;
  }
  const conversation = existing as ChatConversation;

  // Message entrant ; un doublon (Meta renvoie parfois la même notification) est ignoré.
  const { error: insertError } = await admin.from("chat_messages").insert({
    organization_id: org,
    conversation_id: conversation.id,
    sender: "contact",
    body: msg.text.slice(0, 4096),
    external_id: msg.messageId,
  });
  if (insertError) {
    if (insertError.code === "23505") return { reply: null, conversationId: conversation.id };
    throw new Error(`Message : ${insertError.message}`);
  }

  // L'équipe a la main : passage demandé (needs_human) ou réponse d'un employé récente (pause).
  const pausedByStaff = conversation.bot_paused_until !== null && new Date(conversation.bot_paused_until) > new Date();
  const waitingForStaff = conversation.status === "human" && (pausedByStaff || conversation.needs_human);
  const botReplies = settings.enabled && !waitingForStaff;

  await admin
    .from("chat_conversations")
    .update({
      last_message_at: now,
      last_message_preview: preview,
      last_inbound_at: now,
      unread_count: conversation.unread_count + 1,
      contact_name: conversation.contact_name ?? msg.senderName,
      // Conversation fermée, ou pause de l'équipe terminée : le bot reprend.
      ...(conversation.status !== "bot" && !waitingForStaff ? { status: "bot" } : {}),
    })
    .eq("organization_id", org)
    .eq("id", conversation.id);

  const events: Array<{ kind: string; details?: Record<string, unknown> }> = [];
  if (isNew) events.push({ kind: "conversation_started" });

  if (!botReplies) {
    if (waitingForStaff) {
      await admin.rpc("chatbot_notify_staff", {
        p_org: org,
        p_conversation: conversation.id,
        p_title: `Nouveau message${msg.senderName ? ` de ${msg.senderName}` : ""}`,
        p_body: preview,
      });
    }
    await logEvents(admin, conversation, events);
    return { reply: null, conversationId: conversation.id };
  }

  let reply: string;
  let handoff = false;
  let usage = { inputTokens: 0, outputTokens: 0 };
  try {
    const result = await generateBotReply({ admin, settings, conversation, events });
    reply = result.text;
    handoff = result.handoff;
    usage = { inputTokens: result.inputTokens, outputTokens: result.outputTokens };
    events.push({ kind: "bot_reply", details: { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens } });
  } catch (err) {
    // IA indisponible (clé absente, quota…) : l'équipe prend le relais.
    reply = settings.handoff_message;
    handoff = true;
    events.push({ kind: "error", details: { message: (err as Error).message.slice(0, 300) } });
  }

  const sent = await deliver(admin, conversation, msg.accountExternalId, reply);
  await admin.from("chat_messages").insert({
    organization_id: org,
    conversation_id: conversation.id,
    sender: "bot",
    body: reply.slice(0, 4096),
    external_id: sent.externalId,
    delivery_error: sent.error,
    input_tokens: usage.inputTokens || null,
    output_tokens: usage.outputTokens || null,
  });
  await admin
    .from("chat_conversations")
    .update({
      last_message_at: new Date().toISOString(),
      last_message_preview: reply.slice(0, 140),
      ...(handoff ? { needs_human: true, status: "human" } : {}),
    })
    .eq("organization_id", org)
    .eq("id", conversation.id);

  if (handoff) {
    await admin.rpc("chatbot_notify_staff", {
      p_org: org,
      p_conversation: conversation.id,
      p_title: "Client en attente d'un conseiller",
      p_body: `${msg.senderName ?? "Un client"} : ${preview}`,
    });
  }
  await logEvents(admin, conversation, events);
  return { reply, conversationId: conversation.id };
}

/** Envoie un texte sur le canal de la conversation (rien pour le simulateur). */
export async function deliver(
  admin: SupabaseClient,
  conversation: ChatConversation,
  accountExternalId: string | null,
  text: string,
): Promise<{ externalId: string | null; error: string | null }> {
  if (conversation.channel === "simulator") return { externalId: null, error: null };
  try {
    if (!conversation.account_id) throw new Error("Compte non relié");
    let externalId = accountExternalId;
    if (!externalId) {
      const { data } = await admin.from("chat_channel_accounts").select("external_id").eq("id", conversation.account_id).single();
      externalId = (data?.external_id as string | undefined) ?? null;
    }
    const { data: token } = await admin.rpc("chatbot_account_token", { p_account: conversation.account_id });
    if (!token || !externalId) throw new Error("Compte déconnecté ou jeton manquant");
    const id = await sendMetaText(conversation.channel, externalId, token as string, conversation.external_user_id, text);
    return { externalId: id, error: null };
  } catch (err) {
    return { externalId: null, error: (err as Error).message.slice(0, 300) };
  }
}
