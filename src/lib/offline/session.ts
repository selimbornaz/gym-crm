import "server-only";
import { cookies } from "next/headers";
import { OFFLINE_COOKIE } from "./client";
import { isOnline } from "./connectivity";
import { getMeta, pendingCount, rememberAccount, signSession, verifyAccount } from "./store";

/** Une coupure en cours de journée n'interrompt pas le travail pendant ce délai. */
const SESSION_MS = 12 * 60 * 60 * 1000;

export async function setOfflineSession(userId: string): Promise<void> {
  const expires = Date.now() + SESSION_MS;
  (await cookies()).set(OFFLINE_COOKIE, signSession(userId, expires), {
    httpOnly: true, sameSite: "strict", secure: false, path: "/", expires: new Date(expires),
  });
}

export async function clearOfflineSession(): Promise<void> {
  (await cookies()).delete(OFFLINE_COOKIE);
}

/** Après une connexion en ligne : autorise ce compte à se reconnecter hors ligne ici. */
export async function rememberOnlineLogin(email: string, password: string, userId: string): Promise<void> {
  // Une panne de la copie locale prive seulement du mode hors ligne, jamais de la connexion.
  try {
    rememberAccount(email, password, userId);
    await setOfflineSession(userId);
  } catch (err) {
    console.error("[stockage]", err instanceof Error ? err.message : err);
  }
}

/** Connexion sans Internet. Renvoie un message d'erreur, ou null si elle a réussi. */
export async function offlineSignIn(email: string, password: string): Promise<string | null> {
  const result = verifyAccount(email, password);
  if (result.ok) {
    await setOfflineSession(result.userId);
    return null;
  }
  return result.reason === "locked"
    ? "Trop d'essais : réessayez dans une minute."
    : "Connexion hors ligne impossible : mot de passe incorrect, ou première connexion sur ce poste (Internet requis).";
}

/** État du poste pour le bandeau. Une panne de la copie locale ne gêne jamais le travail en ligne. */
export async function offlineNotice(userId: string): Promise<{ offline: boolean; lastSync: string | null; pending: number }> {
  const offline = !(await isOnline());
  try {
    return { offline, lastSync: offline ? getMeta(userId, "last_sync") : null, pending: pendingCount(userId) };
  } catch (err) {
    console.error("[stockage]", err instanceof Error ? err.message : err);
    return { offline, lastSync: null, pending: 0 };
  }
}
