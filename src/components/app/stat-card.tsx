import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Tuile KPI compacte : libellé, chiffre, contexte ; cliquable vers le détail. */
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
    <Card interactive={!!href} className="h-full">
      <div className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between">
          <span className="text-eyebrow">{label}</span>
          <span
            className={cn(
              "flex size-7 items-center justify-center rounded-md bg-secondary text-muted-foreground ring-1 ring-inset ring-border transition-colors duration-300 ease-out",
              tone === "warning" && "bg-amber-500/10 text-amber-600 ring-amber-500/20 dark:text-amber-400",
              tone === "danger" && "bg-red-500/10 text-red-600 ring-red-500/20 dark:text-red-400",
            )}
          >
            <Icon className="size-3.5" strokeWidth={1.75} aria-hidden />
          </span>
        </div>
        <p className="text-figure text-[26px] leading-none">{value}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </Card>
  );
  return href ? (
    <Link href={href} className="rounded-xl transition-all duration-300 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
      {body}
    </Link>
  ) : (
    body
  );
}
