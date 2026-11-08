import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { publicEnv } from "@/lib/env";
import { OP_PERMISSION, runChatOpLocally, type ChatOp } from "@/lib/chatbot/remote";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("staff_reply"), orgId: z.string().uuid(), conversationId: z.string().uuid(), body: z.string().trim().min(1).max(2000) }),
  z.object({ op: z.literal("simulator_send"), orgId: z.string().uuid(), body: z.string().trim().min(1).max(1000), phone: z.string().trim().max(30).nullable() }),
  z.object({ op: z.literal("simulator_reset"), orgId: z.string().uuid() }),
]);

const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });

/**
 * Opérations du chatbot demandées par l'application de bureau, qui n'embarque
 * aucun secret. Le jeton de session Supabase de l'utilisateur est vérifié ici, puis
 * l'appartenance active à la salle et la permission, exactement comme sur le site.
 */
export async function POST(request: NextRequest) {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return json({ error: "Session expirée : reconnectez-vous." }, 401);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Requête invalide." }, 400);
  const { orgId, ...op } = parsed.data;

  // Client de l'utilisateur : toutes ses requêtes restent soumises à la RLS.
  const db = createClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData } = await db.auth.getUser(token);
  const user = userData.user;
  if (!user) return json({ error: "Session expirée : reconnectez-vous." }, 401);

  const [{ data: staff }, { data: perms }, { data: profile }] = await Promise.all([
    db.from("staff").select("user_id").eq("organization_id", orgId).eq("user_id", user.id).eq("is_active", true).maybeSingle(),
    db.rpc("my_permissions", { org: orgId }),
    db.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
  ]);
  const permissions = new Set<string>((perms as string[] | null) ?? []);
  if (!staff || !permissions.has(OP_PERMISSION[op.op])) return json({ error: "Action non autorisée." }, 403);

  try {
    const result = await runChatOpLocally(
      { db, userId: user.id, fullName: (profile?.full_name as string | undefined) || user.email || "", orgId },
      op as ChatOp,
    );
    return json(result);
  } catch (err) {
    console.error("chatbot remote", err);
    return json({ error: "Erreur du serveur : réessayez." }, 500);
  }
}
