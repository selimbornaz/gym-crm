import { after, NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { handleIncoming } from "@/lib/chatbot/inbound";
import { parseMetaWebhook, verifyMetaSignature } from "@/lib/chatbot/meta";

export const dynamic = "force-dynamic";
// Le traitement continue après la réponse 200 (réponse IA + envoi) : marge large.
export const maxDuration = 60;

/** Vérification du webhook par Meta (une fois, lors de la configuration). */
export function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  if (p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === serverEnv.metaVerifyToken) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return new NextResponse("Interdit", { status: 403 });
}

/**
 * Messages entrants Instagram, Messenger et WhatsApp. On répond 200 tout de suite
 * (sinon Meta renvoie la notification), puis le bot traite chaque message.
 */
export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (!verifyMetaSignature(raw, request.headers.get("x-hub-signature-256"), serverEnv.metaAppSecret)) {
    return new NextResponse("Signature invalide", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new NextResponse("JSON invalide", { status: 400 });
  }
  const messages = parseMetaWebhook(payload);
  if (!messages.length) return NextResponse.json({ ok: true });

  after(async () => {
    const admin = createAdminClient();
    for (const m of messages) {
      // Le compte destinataire désigne la salle ; inconnu ou désactivé : ignoré.
      const { data: account } = await admin
        .from("chat_channel_accounts")
        .select("id, organization_id, enabled")
        .eq("channel", m.channel)
        .eq("external_id", m.accountExternalId)
        .maybeSingle();
      if (!account?.enabled) continue;
      try {
        await handleIncoming(admin, {
          organizationId: account.organization_id as string,
          channel: m.channel,
          accountId: account.id as string,
          accountExternalId: m.accountExternalId,
          senderId: m.senderId,
          senderName: m.senderName,
          senderPhone: m.senderPhone,
          messageId: m.messageId,
          text: m.text,
          isText: m.isText,
        });
      } catch (err) {
        console.error("[chatbot] message non traité :", (err as Error).message);
      }
    }
  });

  return NextResponse.json({ ok: true });
}
