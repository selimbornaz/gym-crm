import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient, type ServerSupabase } from "@/lib/supabase/server";
import type { Permission, StaffRole } from "@/lib/permissions";

export const ORG_COOKIE = "gym_org";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  currency: string;
  timezone: string;
  locale: "fr" | "ar";
  logo_path: string | null;
}

export interface AppContext {
  supabase: ServerSupabase;
  user: { id: string; email: string | null };
  fullName: string;
  org: Organization;
  role: StaffRole;
  permissions: ReadonlySet<string>;
  organizations: Array<{ id: string; name: string; role: StaffRole }>;
  can: (...perms: Permission[]) => boolean;
}

/**
 * Contexte de la requête : utilisateur, salle active, rôle, permissions.
 * Mis en cache pour la durée d'une requête (React `cache`).
 * La salle active est choisie par cookie PARMI les salles où l'utilisateur
 * est employé actif : un cookie falsifié ne donne accès à rien.
 */
export const getContext = cache(async (): Promise<AppContext | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: staffRows } = await supabase
    .from("staff")
    .select("role, organization:organizations(id, name, slug, currency, timezone, locale, logo_path)")
    .eq("user_id", user.id)
    .eq("is_active", true);

  const memberships = (staffRows ?? [])
    .map((row) => ({ role: row.role as StaffRole, org: row.organization as unknown as Organization | null }))
    .filter((m): m is { role: StaffRole; org: Organization } => m.org !== null);
  if (memberships.length === 0) return null;

  const wanted = (await cookies()).get(ORG_COOKIE)?.value;
  const active = memberships.find((m) => m.org.id === wanted) ?? memberships[0]!;

  const [{ data: perms }, { data: profile }] = await Promise.all([
    supabase.rpc("my_permissions", { org: active.org.id }),
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
  ]);
  const permissions = new Set<string>((perms as string[] | null) ?? []);

  return {
    supabase,
    user: { id: user.id, email: user.email ?? null },
    fullName: profile?.full_name || user.email || "",
    org: active.org,
    role: active.role,
    permissions,
    organizations: memberships.map((m) => ({ id: m.org.id, name: m.org.name, role: m.role })),
    can: (...wantedPerms) => wantedPerms.some((p) => permissions.has(p)),
  };
});

/** Pour les pages : redirige vers /login (non connecté) ou /no-access (sans salle). */
export async function requireContext(): Promise<AppContext> {
  const ctx = await getContext();
  if (ctx) return ctx;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  redirect(user ? "/no-access" : "/login");
}

/** Pour les pages : exige au moins une des permissions, sinon page « accès refusé ». */
export async function requirePagePermission(...perms: Permission[]): Promise<AppContext> {
  const ctx = await requireContext();
  if (!ctx.can(...perms)) redirect("/forbidden");
  return ctx;
}
