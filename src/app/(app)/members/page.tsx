import type { Metadata } from "next";
import Link from "next/link";
import { Download, UserPlus, Users } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Pagination, pageRange } from "@/components/app/pagination";
import { SearchBar } from "@/components/app/search-bar";
import { MembershipBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { requirePagePermission } from "@/lib/auth/context";
import { formatDate } from "@/lib/format";
import { sanitizeSearch } from "@/lib/validation";
import { t } from "@/i18n";
import type { MemberRow } from "@/lib/types";

export const metadata: Metadata = { title: "Membres" };

const STATUSES = ["active", "expiring", "expired", "suspended", "none", "archived"] as const;

type SP = { q?: string; status?: string; coach?: string; page?: string };

export default async function MembersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await requirePagePermission("members.read_all", "members.read_assigned");
  const { page, from, to } = pageRange(sp.page);
  const q = sanitizeSearch(sp.q);
  const status = STATUSES.find((s) => s === sp.status);

  let query = ctx.supabase
    .from("member_directory")
    .select("id, member_code, full_name, phone, email, coach_name, membership_status, membership_end_date, registered_on", { count: "exact" })
    .eq("organization_id", ctx.org.id);

  if (q) query = query.or(`first_name.ilike.*${q}*,last_name.ilike.*${q}*,member_code.ilike.*${q}*,phone.ilike.*${q}*,email.ilike.*${q}*`);
  if (status) query = query.eq("membership_status", status);
  else query = query.neq("membership_status", "archived");
  if (sp.coach && /^[0-9a-f-]{36}$/.test(sp.coach)) query = query.eq("coach_id", sp.coach);

  const [{ data, count }, { data: coaches }] = await Promise.all([
    query.order("last_name").order("first_name").range(from, to),
    ctx.supabase.from("coaches").select("id, full_name").eq("organization_id", ctx.org.id).order("full_name"),
  ]);
  const members = (data ?? []) as Pick<
    MemberRow,
    "id" | "member_code" | "full_name" | "phone" | "email" | "coach_name" | "membership_status" | "membership_end_date" | "registered_on"
  >[];
  const exportHref = `/members/export?${new URLSearchParams(Object.entries({ q: sp.q ?? "", status: sp.status ?? "" }).filter(([, v]) => v))}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Membres"
        description={ctx.can("members.read_all") ? "Tous les membres de la salle." : "Les membres qui vous sont assignés."}
        actions={
          <>
            {ctx.can("members.export") && (
              <Button asChild variant="outline">
                <a href={exportHref}>
                  <Download aria-hidden /> Exporter CSV
                </a>
              </Button>
            )}
            {ctx.can("members.write") && (
              <Button asChild>
                <Link href="/members/new">
                  <UserPlus aria-hidden /> Nouveau membre
                </Link>
              </Button>
            )}
          </>
        }
      />

      <SearchBar placeholder="Nom, téléphone, email ou n° membre" defaultValue={sp.q} resetHref="/members">
        <NativeSelect name="status" defaultValue={sp.status ?? ""} aria-label="Statut" className="w-auto bg-card">
          <option value="">Tous (hors archivés)</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t.membershipStatus[s]}
            </option>
          ))}
        </NativeSelect>
        {ctx.can("members.read_all") && (
          <NativeSelect name="coach" defaultValue={sp.coach ?? ""} aria-label="Coach" className="w-auto bg-card">
            <option value="">Tous les coachs</option>
            {(coaches ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name}
              </option>
            ))}
          </NativeSelect>
        )}
      </SearchBar>

      {members.length === 0 ? (
        <EmptyState
          icon={Users}
          title={q || status ? "Aucun membre ne correspond" : "Aucun membre pour l'instant"}
          description={q || status ? "Modifiez la recherche ou les filtres." : "Ajoutez votre premier membre pour commencer."}
          action={
            !q && !status && ctx.can("members.write") ? (
              <Button asChild>
                <Link href="/members/new">Nouveau membre</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <Table>
            <THead>
              <tr>
                <Th>Membre</Th>
                <Th>Contact</Th>
                <Th>Statut</Th>
                <Th>Fin d&apos;abonnement</Th>
                <Th>Coach</Th>
                <Th>Inscrit le</Th>
              </tr>
            </THead>
            <TBody>
              {members.map((m) => (
                <Tr key={m.id}>
                  <Td>
                    <Link href={`/members/${m.id}`} className="font-medium hover:underline">
                      {m.full_name}
                    </Link>
                    <p className="font-mono text-xs text-muted-foreground">{m.member_code}</p>
                  </Td>
                  <Td>
                    <p>{m.phone ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">{m.email}</p>
                  </Td>
                  <Td>
                    <MembershipBadge status={m.membership_status} />
                  </Td>
                  <Td className="whitespace-nowrap">{formatDate(m.membership_end_date)}</Td>
                  <Td>{m.coach_name ?? "—"}</Td>
                  <Td className="whitespace-nowrap">{formatDate(m.registered_on)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
          <Pagination page={page} total={count ?? 0} searchParams={sp} />
        </>
      )}
    </div>
  );
}
