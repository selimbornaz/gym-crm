import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface Metric {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  hint?: ReactNode;
  tone?: "warning" | "danger" | "success";
}

/**
 * Bande de métriques : une seule surface, cellules séparées par des lignes de
 * 1 px (au lieu de tuiles isolées). Passe en 2 colonnes sur mobile.
 */
export function MetricStrip({ metrics, className }: { metrics: Metric[]; className?: string }) {
  return (
    <dl
      className={cn(
        "edge-highlight grid grid-cols-2 overflow-hidden rounded-xl border bg-card shadow-card",
        metrics.length >= 4 ? "lg:grid-cols-4" : "sm:grid-cols-3",
        className,
      )}
    >
      {metrics.map((m, i) => {
        const Icon = m.icon;
        return (
          <div
            key={m.label}
            className={cn(
              "flex flex-col gap-2 px-5 py-4 transition-colors duration-300 ease-out hover:bg-accent/30",
              // Lignes de séparation : verticales entre colonnes, horizontales entre rangées (mobile).
              i % 2 === 1 && "border-l",
              metrics.length >= 4 && i >= 2 && "border-t lg:border-t-0 lg:border-l",
              metrics.length === 3 && i === 2 && "border-t sm:border-t-0 sm:border-l",
            )}
          >
            <dt className="flex items-center gap-1.5 text-eyebrow">
              {Icon && <Icon className="size-3.5" strokeWidth={1.75} aria-hidden />}
              {m.label}
            </dt>
            <dd
              className={cn(
                "text-figure text-[22px] leading-none",
                m.tone === "danger" && "text-red-600 dark:text-red-400",
                m.tone === "warning" && "text-amber-600 dark:text-amber-400",
                m.tone === "success" && "text-emerald-600 dark:text-emerald-400",
              )}
            >
              {m.value}
            </dd>
            {m.hint && <p className="text-[11px] text-subtle-foreground">{m.hint}</p>}
          </div>
        );
      })}
    </dl>
  );
}
