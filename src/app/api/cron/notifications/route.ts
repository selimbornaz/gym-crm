import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Tâche planifiée quotidienne (Vercel Cron) : génère les alertes de toutes les
 * salles. Protégée par `Authorization: Bearer <CRON_SECRET>`.
 * Elle ne fait QUE des notifications in-app : aucun SMS/email/WhatsApp n'est
 * envoyé tant qu'aucun fournisseur n'est intégré.
 */
export async function GET(request: Request) {
  const expected = `Bearer ${serverEnv.cronSecret}`;
  const header = request.headers.get("authorization") ?? "";
  if (header.length !== expected.length || !timingSafeEqual(Buffer.from(header), Buffer.from(expected))) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: orgs, error } = await admin.from("organizations").select("id");
  if (error) return NextResponse.json({ error: "Lecture des salles impossible" }, { status: 500 });

  const results = await Promise.allSettled(
    (orgs ?? []).map(async (o) => {
      const { data, error: rpcError } = await admin.rpc("refresh_notifications", { p_org: o.id });
      if (rpcError) throw new Error(rpcError.message);
      return data as number;
    }),
  );
  const created = results.reduce((n, r) => n + (r.status === "fulfilled" ? r.value : 0), 0);
  const failed = results.filter((r) => r.status === "rejected").length;
  return NextResponse.json({ organizations: orgs?.length ?? 0, notificationsCreated: created, failed });
}
