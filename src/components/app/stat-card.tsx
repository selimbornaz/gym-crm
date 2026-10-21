import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Tuile KPI : chiffre-clé, libellé, contexte ; cliquable vers le détail. */
export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  href,
  tone,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  hint?: string;
  href?: string;
  tone?: "warning" | "danger";
}) {
  const body = (
    <Card className={cn("h-full transition-colors", href && "hover:border-ring/50")}>
      <CardContent className="flex flex-col gap-2 p-5">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{label}</span>
          <Icon className={cn("size-4", tone === "warning" && "text-warning", tone === "danger" && "text-danger")} aria-hidden />
        </div>
        <p className="text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
  return href ? (
    <Link href={href} className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {body}
    </Link>
  ) : (
    body
  );
}
