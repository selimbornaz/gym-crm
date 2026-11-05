import "server-only";
import { NEEDS_INTERNET, type LocalError } from "./errors";
import { LocalQuery } from "./query";
import { runLocalRpc } from "./rpc";
import { accountEmail, verifySession } from "./store";

export const OFFLINE_COOKIE = "castle_offline";

class RpcCall implements PromiseLike<{ data: unknown; error: LocalError | null; count: number | null }> {
  constructor(private user: string, private name: string, private args: Record<string, unknown>) {}
  then<A, B = never>(
    onFulfilled?: ((value: { data: unknown; error: LocalError | null; count: number | null }) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    return new Promise<{ data: unknown; error: LocalError | null; count: number | null }>((resolve) =>
      resolve(runLocalRpc(this.user, this.name, this.args)),
    ).then(onFulfilled, onRejected);
  }
}

/**
 * Client hors ligne : même interface que le client Supabase pour ce que les pages
 * utilisent. Sans session hors ligne valide, il ne lit rien et ne renvoie aucun
 * utilisateur, ce qui mène à la page de connexion.
 */
export function createLocalClient(sessionCookie: string | undefined) {
  const userId = verifySession(sessionCookie);
  const noUser = "";
  return {
    from: (table: string) => new LocalQuery(userId ?? noUser, table),
    rpc: (name: string, args: Record<string, unknown> = {}) => new RpcCall(userId ?? noUser, name, args),
    auth: {
      getUser: async () =>
        userId
          ? { data: { user: { id: userId, email: accountEmail(userId) } }, error: null }
          : { data: { user: null }, error: { name: "AuthSessionMissingError", message: "Session absente" } },
      signOut: async () => ({ error: null }),
      signInWithPassword: async () => ({ data: { user: null }, error: NEEDS_INTERNET.error }),
      resetPasswordForEmail: async () => ({ data: null, error: NEEDS_INTERNET.error }),
      updateUser: async () => ({ data: { user: null }, error: NEEDS_INTERNET.error }),
    },
    storage: {
      from: () => ({
        createSignedUrl: async () => ({ data: null, error: { message: "Photo indisponible hors ligne" } }),
        upload: async () => ({ data: null, error: NEEDS_INTERNET.error }),
      }),
    },
  };
}
