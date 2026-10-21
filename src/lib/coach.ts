import "server-only";
import type { AppContext } from "@/lib/auth/context";

/** Fiche coach liée au compte connecté dans la salle active (null si aucune). */
export async function getMyCoachId(ctx: AppContext): Promise<string | null> {
  const { data } = await ctx.supabase
    .from("coaches")
    .select("id, staff!inner(user_id)")
    .eq("organization_id", ctx.org.id)
    .eq("staff.user_id", ctx.user.id)
    .eq("is_active", true)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}
