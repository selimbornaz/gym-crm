import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv, serverEnv } from "@/lib/env";

/**
 * Client « service role » : CONTOURNE la RLS. Réservé à des opérations
 * précises, toujours APRÈS une vérification d'autorisation explicite :
 *  - création des comptes employés (API Admin Auth) ;
 *  - tâche planifiée des notifications.
 * `server-only` garantit qu'il n'est jamais inclus dans un bundle client.
 */
export function createAdminClient() {
  return createClient(publicEnv.supabaseUrl, serverEnv.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
