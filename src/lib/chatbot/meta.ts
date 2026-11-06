import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { ChatChannel } from "./types";

const GRAPH = "https://graph.facebook.com/v21.0";

/** Vérifie l'en-tête X-Hub-Signature-256 (HMAC SHA-256 du corps brut avec le secret de l'app). */
export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`);
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export interface InboundMessage {
  channel: Exclude<ChatChannel, "simulator">;
  /** Compte de la salle chez Meta : phone_number_id (WhatsApp), id de page ou de compte Instagram. */
  accountExternalId: string;
  /** Expéditeur : numéro WhatsApp, PSID Messenger ou IGSID Instagram. */
  senderId: string;
  senderName: string | null;
  senderPhone: string | null;
  messageId: string;
  /** Texte du message, ou description d'une pièce jointe. */
  text: string;
  isText: boolean;
}

type Json = Record<string, unknown>;
const asArray = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const asObject = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});
const asString = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Extrait les messages entrants d'une notification Meta (les échos et accusés sont ignorés). */
export function parseMetaWebhook(payload: unknown): InboundMessage[] {
  const body = asObject(payload);
  const out: InboundMessage[] = [];

  if (body.object === "whatsapp_business_account") {
    for (const entry of asArray(body.entry)) {
      for (const change of asArray(entry.changes)) {
        const value = asObject(change.value);
        const phoneNumberId = asString(asObject(value.metadata).phone_number_id);
        const names = new Map(asArray(value.contacts).map((c) => [asString(c.wa_id), asString(asObject(c.profile).name)]));
        for (const m of asArray(value.messages)) {
          const from = asString(m.from);
          const id = asString(m.id);
          if (!phoneNumberId || !from || !id) continue;
          const text = asString(asObject(m.text).body);
          out.push({
            channel: "whatsapp",
            accountExternalId: phoneNumberId,
            senderId: from,
            senderName: names.get(from) ?? null,
            senderPhone: from,
            messageId: id,
            text: text ?? `[${asString(m.type) ?? "message"} non textuel]`,
            isText: text !== null,
          });
        }
      }
    }
  }

  if (body.object === "page" || body.object === "instagram") {
    const channel = body.object === "page" ? "messenger" : "instagram";
    for (const entry of asArray(body.entry)) {
      const accountId = asString(entry.id);
      for (const event of asArray(entry.messaging)) {
        const message = asObject(event.message);
        const sender = asString(asObject(event.sender).id);
        const id = asString(message.mid);
        if (!accountId || !sender || !id || message.is_echo) continue;
        const text = asString(message.text);
        out.push({
          channel,
          accountExternalId: accountId,
          senderId: sender,
          senderName: null,
          senderPhone: null,
          messageId: id,
          text: text ?? "[pièce jointe]",
          isText: text !== null,
        });
      }
    }
  }
  return out;
}

/**
 * Envoie un texte au contact. Messenger et Instagram passent par le jeton de la
 * page (/me/messages) ; WhatsApp par le numéro professionnel (phone_number_id).
 * Retourne l'identifiant du message chez Meta, ou lève une erreur lisible.
 */
export async function sendMetaText(
  channel: Exclude<ChatChannel, "simulator">,
  accountExternalId: string,
  accessToken: string,
  recipientId: string,
  text: string,
): Promise<string | null> {
  const isWhatsApp = channel === "whatsapp";
  const url = isWhatsApp ? `${GRAPH}/${accountExternalId}/messages` : `${GRAPH}/me/messages`;
  const body = isWhatsApp
    ? { messaging_product: "whatsapp", to: recipientId, type: "text", text: { body: text.slice(0, 4096), preview_url: false } }
    : { recipient: { id: recipientId }, messaging_type: "RESPONSE", message: { text: text.slice(0, 1000) } };

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok) {
    const err = asObject(data.error);
    throw new Error(`Meta ${res.status} : ${asString(err.message) ?? "envoi refusé"}`);
  }
  return isWhatsApp ? asString(asArray(data.messages)[0]?.id) : asString(data.message_id);
}
