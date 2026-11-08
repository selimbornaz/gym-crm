"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, dbErrorMessage, parseForm } from "@/lib/actions";
import type { ActionState } from "@/lib/action-state";
import { uuid } from "@/lib/validation";
import { runChatOp } from "@/lib/chatbot/remote";

const replySchema = z.object({
  conversation_id: uuid,
  body: z.string().trim().min(1, "Message vide").max(2000),
});

/**
 * Réponse d'un employé : enregistrée en son nom (RLS), envoyée au client, et le
 * bot se met en pause pour cette conversation pendant le délai réglé.
 */
export async function sendStaffReply(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize("chatbot.inbox");
  if (auth.denied) return auth.denied;
  const parsed = parseForm(replySchema, formData);
  if (parsed.error) return parsed.error;
  const result = await runChatOp(auth.ctx, { op: "staff_reply", conversationId: parsed.data.conversation_id, body: parsed.data.body });
  revalidatePath("/chatbot");
  return result;
}

const statusSchema = z.object({
  conversation_id: uuid,
  action: z.enum(["take_over", "give_back", "close", "read"]),
});

/** Reprendre la main, rendre au bot, clore, ou marquer comme lu. */
export async function updateConversation(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize("chatbot.inbox");
  if (auth.denied) return auth.denied;
  const parsed = parseForm(statusSchema, formData);
  if (parsed.error) return parsed.error;
  const { conversation_id, action } = parsed.data;

  const changes: Record<string, unknown> =
    action === "take_over"
      ? { status: "human", needs_human: false, unread_count: 0, bot_paused_until: new Date(Date.now() + 24 * 3_600_000).toISOString() }
      : action === "give_back"
        ? { status: "bot", needs_human: false, bot_paused_until: null }
        : action === "close"
          ? { status: "closed", needs_human: false, unread_count: 0, bot_paused_until: null }
          : { unread_count: 0 };
  const { error } = await auth.ctx.supabase.from("chat_conversations").update(changes).eq("organization_id", auth.ctx.org.id).eq("id", conversation_id);
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/chatbot");
  return { ok: true };
}

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().transform((v) => (v ? v : null));

const settingsSchema = z.object({
  enabled: z.literal("on").optional(),
  bot_name: z.string().trim().min(2, "Nom trop court").max(60),
  tone: z.string().trim().min(2).max(200),
  welcome_message: optionalText(600),
  knowledge: z.string().trim().max(12000).optional().default(""),
  handoff_message: z.string().trim().min(5).max(300),
  allow_member_info: z.literal("on").optional(),
  allow_booking: z.literal("on").optional(),
  allow_leads: z.literal("on").optional(),
  human_pause_minutes: z.coerce.number().int().min(5).max(2880),
});

export async function saveChatbotSettings(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize("chatbot.manage");
  if (auth.denied) return auth.denied;
  const parsed = parseForm(settingsSchema, formData);
  if (parsed.error) return parsed.error;
  const d = parsed.data;
  const { error } = await auth.ctx.supabase.from("chatbot_settings").upsert({
    organization_id: auth.ctx.org.id,
    enabled: d.enabled === "on",
    bot_name: d.bot_name,
    tone: d.tone,
    welcome_message: d.welcome_message,
    knowledge: d.knowledge,
    handoff_message: d.handoff_message,
    allow_member_info: d.allow_member_info === "on",
    allow_booking: d.allow_booking === "on",
    allow_leads: d.allow_leads === "on",
    human_pause_minutes: d.human_pause_minutes,
  });
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/chatbot");
  return { ok: true, message: "Réglages du chatbot enregistrés." };
}

const accountSchema = z.object({
  channel: z.enum(["whatsapp", "instagram", "messenger"]),
  external_id: z.string().trim().regex(/^[0-9]{5,30}$/, "Identifiant numérique attendu (voir le guide)"),
  display_name: z.string().trim().max(120).optional(),
  access_token: z.string().trim().min(20, "Jeton d'accès trop court").max(2000),
});

/** Relie un compte Meta ; le jeton part directement dans le schéma privé (jamais relu par l'interface). */
export async function connectChannelAccount(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize("chatbot.manage");
  if (auth.denied) return auth.denied;
  const parsed = parseForm(accountSchema, formData);
  if (parsed.error) return parsed.error;
  const d = parsed.data;
  const { error } = await auth.ctx.supabase.rpc("chatbot_connect_account", {
    p_org: auth.ctx.org.id,
    p_channel: d.channel,
    p_external_id: d.external_id,
    p_display_name: d.display_name ?? "",
    p_access_token: d.access_token,
  });
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/chatbot");
  return { ok: true, message: "Compte relié." };
}

const accountToggleSchema = z.object({ account_id: uuid, action: z.enum(["enable", "disable", "remove"]) });

export async function updateChannelAccount(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize("chatbot.manage");
  if (auth.denied) return auth.denied;
  const parsed = parseForm(accountToggleSchema, formData);
  if (parsed.error) return parsed.error;
  const { account_id, action } = parsed.data;
  const q = auth.ctx.supabase.from("chat_channel_accounts");
  const { error } =
    action === "remove"
      ? await q.delete().eq("organization_id", auth.ctx.org.id).eq("id", account_id)
      : await q.update({ enabled: action === "enable" }).eq("organization_id", auth.ctx.org.id).eq("id", account_id);
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/chatbot");
  return { ok: true };
}

const simulatorSchema = z.object({
  body: z.string().trim().min(1, "Message vide").max(1000),
  phone: z.string().trim().max(30).optional(),
});

/**
 * Simulateur : parle au bot exactement comme un client, sans compte Meta.
 * Le numéro facultatif permet de tester l'identification d'un membre (comme sur WhatsApp).
 */
export async function simulatorSend(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize("chatbot.manage");
  if (auth.denied) return auth.denied;
  const parsed = parseForm(simulatorSchema, formData);
  if (parsed.error) return parsed.error;
  let result: ActionState;
  try {
    result = await runChatOp(auth.ctx, { op: "simulator_send", body: parsed.data.body, phone: parsed.data.phone || null });
  } catch (err) {
    console.error("simulateur", err);
    result = { error: "Le simulateur n'a pas pu traiter le message : réessayez." };
  }
  revalidatePath("/chatbot");
  return result;
}

/** Efface la conversation de test de l'utilisateur. */
export async function simulatorReset(): Promise<ActionState> {
  const auth = await authorize("chatbot.manage");
  if (auth.denied) return auth.denied;
  const result = await runChatOp(auth.ctx, { op: "simulator_reset" });
  revalidatePath("/chatbot");
  return result;
}
