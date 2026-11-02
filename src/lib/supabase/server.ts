import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";

/**
 * Client Supabase côté serveur, authentifié avec la session de l'utilisateur
 * (cookies). Toutes les requêtes passent donc par la RLS.
 */
export async function createOnlineClient() {
  const cookieStore = await cookies();
  return createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Appel depuis un Server Component : le middleware rafraîchit la session.
        }
      },
    },
  });
}

export type ServerSupabase = Awaited<ReturnType<typeof createOnlineClient>>;

/**
 * Point d'entrée de toutes les pages. Dans l'application de bureau, sans Internet,
 * il renvoie le client local ; le site web n'inclut jamais ce code (constante de build).
 */
export async function createClient(): Promise<ServerSupabase> {
  if (process.env.NEXT_PUBLIC_CASTLE_DESKTOP === "1") {
    const { isOnline } = await import("@/lib/offline/connectivity");
    if (!(await isOnline())) {
      const { createLocalClient, OFFLINE_COOKIE } = await import("@/lib/offline/client");
      const cookieStore = await cookies();
      return createLocalClient(cookieStore.get(OFFLINE_COOKIE)?.value) as unknown as ServerSupabase;
    }
  }
  return createOnlineClient();
}
