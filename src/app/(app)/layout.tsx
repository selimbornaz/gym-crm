import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { AppShell } from "@/components/app/app-shell";
import { ORG_COOKIE, getContext, requireContext } from "@/lib/auth/context";
import { signOut } from "@/app/(auth)/actions";
import { formatDateTime } from "@/lib/format";

/** Change la salle active — uniquement vers une salle où l'utilisateur est employé. */
async function switchOrganization(formData: FormData) {
  "use server";
  const ctx = await getContext();
  const orgId = String(formData.get("orgId") ?? "");
  if (!ctx || !ctx.organizations.some((o) => o.id === orgId)) return;
  (await cookies()).set(ORG_COOKIE, orgId, { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await requireContext();
  const { count } = await ctx.supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", ctx.org.id)
    .is("read_at", null);

  let offlineNotice: string | null = null;
  if (process.env.NEXT_PUBLIC_CASTLE_DESKTOP === "1") {
    const session = await import("@/lib/offline/session");
    const status = await session.offlineNotice(ctx.user.id);
    const waiting = status.pending > 0 ? ` · ${status.pending} action${status.pending > 1 ? "s" : ""} en attente d'envoi` : "";
    if (status.offline) {
      offlineNotice = `Mode hors ligne${status.lastSync ? ` · données du ${formatDateTime(status.lastSync)}` : ""}${waiting}`;
    } else {
      const { count: toReview } = await ctx.supabase
        .from("sync_ops")
        .select("op_id", { count: "exact", head: true })
        .eq("organization_id", ctx.org.id)
        .eq("user_id", ctx.user.id)
        .in("status", ["conflict", "rejected"])
        .is("resolved_at", null);
      const review = toReview ? ` · ${toReview} action${toReview > 1 ? "s" : ""} à vérifier` : "";
      if (waiting || review) offlineNotice = `Synchronisation${waiting}${review}`;
    }
  }

  return (
    <AppShell
      permissions={[...ctx.permissions]}
      orgName={ctx.org.name}
      orgId={ctx.org.id}
      organizations={ctx.organizations}
      userName={ctx.fullName}
      userEmail={ctx.user.email}
      role={ctx.role}
      unread={count ?? 0}
      offlineNotice={offlineNotice}
      signOutAction={signOut}
      switchOrgAction={switchOrganization}
    >
      {children}
    </AppShell>
  );
}
