/**
 * Variables d'environnement, lues paresseusement pour que `next build` passe
 * sans secrets. Seules les variables NEXT_PUBLIC_* atteignent le navigateur.
 */
function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Variable d'environnement manquante : ${name} (voir .env.example)`);
  return value;
}

export const publicEnv = {
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
  },
  get supabaseAnonKey() {
    return required("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  },
  get siteUrl() {
    return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  },
};

/** Secrets serveur : ne jamais importer depuis un composant client. */
export const serverEnv = {
  get serviceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY);
  },
  get cronSecret() {
    return required("CRON_SECRET", process.env.CRON_SECRET);
  },
};
