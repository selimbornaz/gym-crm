import type { Metadata } from "next";
import Link from "next/link";
import { Bell } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Pagination, pageRange } from "@/components/app/pagination";
import { Badge } from "@/components/ui/badge";
import { requirePagePermission } from "@/lib/auth/context";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";
import { AnnouncementDialog, MarkReadButton } from "./notification-widgets";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ filter?: string; page?: string }> }) {
  const sp = await searchParams;
  const ctx = await requirePagePermission("notifications.read");
  const unreadOnly = sp.filter === "unread";
  const { page, from, to } = pageRange(sp.page);

  let query = ctx.supabase
    .from("notifications")
    .select("id, type, title, body, link, read_at, created_at", { count: "exact" })
    .eq("organization_id", ctx.org.id)
    .eq("recipient_user_id", ctx.user.id);
  if (unreadOnly) query = query.is("read_at", null);
  const { data, count } = await query.order("created_at", { ascending: false }).range(from, to);
  const rows = (data ?? []) as Array<{ id: string; type: keyof typeof t.notificationType; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string }>;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Notifications"
        description="Alertes générées automatiquement chaque jour et annonces internes."
        actions={
          <>
            <MarkReadButton all />
            {ctx.can("announcements.manage") && <AnnouncementDialog />}
          </>
        }
      />
      <nav className="flex gap-2 text-sm" aria-label="Filtre">
        <Link href="/notifications" className={cn("rounded-md px-3 py-1", !unreadOnly ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent/60")}>Toutes</Link>
        <Link href="/notifications?filter=unread" className={cn("rounded-md px-3 py-1", unreadOnly ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent/60")}>Non lues</Link>
      </nav>

      {rows.length === 0 ? (
        <EmptyState icon={Bell} title={unreadOnly ? "Aucune notification non lue" : "Aucune notification"} />
      ) : (
        <>
          <ul className="grid gap-2">
            {rows.map((n) => (
              <li key={n.id} className={cn("flex items-start gap-3 rounded-xl border bg-card p-4", !n.read_at && "border-l-4 border-l-info")}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{t.notificationType[n.type] ?? n.type}</Badge>
                    <time className="text-xs text-muted-foreground" dateTime={n.created_at}>{formatDateTime(n.created_at)}</time>
                  </div>
                  <p className="mt-1 font-medium">{n.title}</p>
                  {n.body && <p className="whitespace-pre-line text-sm text-muted-foreground">{n.body}</p>}
                  {n.link && <Link href={n.link} className="mt-1 inline-block text-sm underline-offset-4 hover:underline">Voir</Link>}
                </div>
                {!n.read_at && <MarkReadButton id={n.id} />}
              </li>
            ))}
          </ul>
          <Pagination page={page} total={count ?? 0} searchParams={sp} />
        </>
      )}
    </div>
  );
}
