import { NextResponse, type NextRequest } from "next/server";
import { createOnlineClient } from "@/lib/supabase/server";
import { HIDDEN_ORG_SLUGS } from "@/lib/auth/context";

export const dynamic = "force-dynamic";

const holder = globalThis as unknown as { __castleSyncing?: boolean };

/**
 * Téléchargement vers le poste, déclenché par l'application de bureau uniquement
 * (jeton généré à chaque lancement). N'existe pas sur le site web : 404.
 */
export async function POST(request: NextRequest) {
  if (process.env.NEXT_PUBLIC_CASTLE_DESKTOP !== "1") return new NextResponse(null, { status: 404 });
  const token = process.env.CASTLE_LOCAL_TOKEN;
  if (!token || request.headers.get("x-castle-token") !== token) return new NextResponse(null, { status: 403 });
  if (holder.__castleSyncing) return NextResponse.json({ status: "busy" });

  holder.__castleSyncing = true;
  try {
    const { isOnline } = await import("@/lib/offline/connectivity");
    if (!(await isOnline())) return NextResponse.json({ status: "offline" });

    const client = await createOnlineClient();
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (!user) {
      // Réseau ou session expirée : les données locales restent en place.
      return NextResponse.json({ status: "signed_out", detail: authError?.name ?? null });
    }

    const { data: staff, error } = await client
      .from("staff")
      .select("organization_id, organization:organizations(slug)")
      .eq("user_id", user.id)
      .eq("is_active", true);
    if (error) throw new Error(error.message);

    const { forgetUser } = await import("@/lib/offline/store");
    const { clearOfflineSession, setOfflineSession } = await import("@/lib/offline/session");
    const orgs = (staff ?? [])
      .filter((s) => {
        const org = s.organization as unknown as { slug: string } | null;
        return org && !HIDDEN_ORG_SLUGS.includes(org.slug);
      })
      .map((s) => s.organization_id as string);

    // Compte sans plus aucun accès : ses données et sa connexion hors ligne sont effacées du poste.
    if (orgs.length === 0) {
      forgetUser(user.id);
      await clearOfflineSession();
      return NextResponse.json({ status: "no_access" });
    }

    const { pullAll } = await import("@/lib/offline/sync");
    const summary = await pullAll(client as never, user.id, orgs);
    await setOfflineSession(user.id);
    return NextResponse.json({ status: "ok", ...summary });
  } catch (err) {
    console.error("[sync]", err instanceof Error ? err.message : err);
    return NextResponse.json({ status: "error" }, { status: 500 });
  } finally {
    holder.__castleSyncing = false;
  }
}
