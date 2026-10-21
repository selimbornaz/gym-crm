import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export const PAGE_SIZE = 25;

/** Décode ?page=N en bornes Supabase (`range(from, to)`). */
export function pageRange(page: string | undefined, size = PAGE_SIZE) {
  const n = Math.max(1, Number.parseInt(page ?? "1", 10) || 1);
  return { page: n, from: (n - 1) * size, to: n * size - 1, size };
}

/** Pagination par liens (fonctionne sans JavaScript, conserve les filtres). */
export function Pagination({
  page,
  total,
  size = PAGE_SIZE,
  searchParams,
}: {
  page: number;
  total: number;
  size?: number;
  searchParams: Record<string, string | undefined>;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages <= 1) return <p className="text-xs text-muted-foreground">{total} résultat{total > 1 ? "s" : ""}</p>;

  const href = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) if (v && k !== "page") params.set(k, v);
    params.set("page", String(p));
    return `?${params.toString()}`;
  };
  const linkCls = "inline-flex h-8 items-center gap-1 rounded-md border bg-card px-2.5 text-sm hover:bg-accent";

  return (
    <nav className="flex items-center justify-between gap-2" aria-label="Pagination">
      <p className="text-xs text-muted-foreground">
        Page {page} / {pages} · {total} résultats
      </p>
      <div className="flex gap-2">
        <Link href={href(page - 1)} aria-disabled={page <= 1} className={cn(linkCls, page <= 1 && "pointer-events-none opacity-50")}>
          <ChevronLeft className="size-4" aria-hidden /> Précédent
        </Link>
        <Link href={href(page + 1)} aria-disabled={page >= pages} className={cn(linkCls, page >= pages && "pointer-events-none opacity-50")}>
          Suivant <ChevronRight className="size-4" aria-hidden />
        </Link>
      </div>
    </nav>
  );
}
