import "server-only";
import { existsSync } from "node:fs";
import { publicEnv } from "@/lib/env";

/** État de la connexion, partagé dans le processus et revérifié périodiquement. */
const ONLINE_TTL_MS = 10_000;
const OFFLINE_TTL_MS = 3_000;
const PROBE_TIMEOUT_MS = 2_500;

const holder = globalThis as unknown as {
  __castleConnectivity?: { online: boolean; checkedAt: number; pending: Promise<boolean> | null };
};

async function probe(): Promise<boolean> {
  try {
    // Toute réponse HTTP prouve que Supabase est joignable, même 401.
    await fetch(`${publicEnv.supabaseUrl}/auth/v1/health`, {
      headers: { apikey: publicEnv.supabaseAnonKey },
      cache: "no-store",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return true;
  } catch {
    return false;
  }
}

export async function isOnline(): Promise<boolean> {
  // Coupure simulée pour les tests : ce fichier ne peut que forcer le mode hors ligne.
  const forced = process.env.CASTLE_TEST_OFFLINE_FILE;
  if (forced && existsSync(forced)) return false;

  const state = (holder.__castleConnectivity ??= { online: true, checkedAt: 0, pending: null });
  if (Date.now() - state.checkedAt < (state.online ? ONLINE_TTL_MS : OFFLINE_TTL_MS)) return state.online;
  state.pending ??= probe().then((online) => {
    state.online = online;
    state.checkedAt = Date.now();
    state.pending = null;
    return online;
  });
  return state.pending;
}
