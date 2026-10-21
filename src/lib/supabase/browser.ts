"use client";

import { createBrowserClient } from "@supabase/ssr";

/** Client navigateur (clé publique uniquement), utilisé pour l'upload de photos. */
export function createBrowserSupabase() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
