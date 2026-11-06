import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { AppShell } from "@/components/app/app-shell";
import { ORG_COOKIE, getContext, requireContext } from "@/lib/auth/context";
import { signOut } from "@/app/(auth)/actions";

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
  const canChat = ctx.can("chatbot.inbox");
  const [{ count }, chat] = await Promise.all([
    // Cloche générale : sans les alertes du chatbot, qui ont leur propre compteur.
    ctx.supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ctx.org.id)
      .is("read_at", null)
      .neq("type", "chatbot"),
    canChat
      ? ctx.supabase
          .from("chat_conversations")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", ctx.org.id)
          .or("needs_human.eq.true,unread_count.gt.0")
      : Promise.resolve({ count: 0 }),
  ]);

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
      chatAttention={canChat ? (chat.count ?? 0) : null}
      signOutAction={signOut}
      switchOrgAction={switchOrganization}
    >
      {children}
    </AppShell>
  );
}
