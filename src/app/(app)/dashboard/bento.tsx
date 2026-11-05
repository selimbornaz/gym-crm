import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Indicateur de tendance : flèche + pourcentage signé, teinte translucide.
 * `goodWhenUp=false` inverse le code couleur (ex. impayés : une hausse est mauvaise).
 */
export function TrendPill({ ratio, goodWhenUp = true, caption }: { ratio: number | null; goodWhenUp?: boolean; caption?: string }) {
  if (ratio === null || !Number.isFinite(ratio)) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-subtle-foreground">
        <Minus className="size-3" strokeWidth={2} aria-hidden /> Pas de base de comparaison
      </span>
    );
  }
  const flat = Math.abs(ratio) < 0.0005;
  const up = ratio > 0;
  const good = flat ? null : up === goodWhenUp;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  const pct = `${up ? "+" : flat ? "" : "−"}${Math.abs(ratio * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} %`;

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn(
          "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ring-1 ring-inset transition-colors duration-300 ease-out",
          good === true && "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-400",
          good === false && "bg-red-500/10 text-red-700 ring-red-500/20 dark:text-red-400",
          good === null && "bg-secondary text-muted-foreground ring-border",
        )}
      >
        <Icon className="size-3" strokeWidth={2.25} aria-hidden />
        {pct}
      </span>
      {caption && <span className="text-[11px] text-subtle-foreground">{caption}</span>}
    </span>
  );
}

/** Cellule de la grille bento : en-tête « eyebrow » + icône + lien facultatif. */
export function BentoCard({
  title,
  icon: Icon,
  href,
  linkLabel = "Voir",
  className,
  children,
  action,
  hero = false,
}: {
  title: string;
  icon?: LucideIcon;
  href?: string;
  linkLabel?: string;
  className?: string;
  children: ReactNode;
  action?: ReactNode;
  /** Carte principale : filet orange métallisé, halo orange, icône en pastille. */
  hero?: boolean;
}) {
  return (
    <Card interactive className={cn("flex flex-col overflow-hidden", hero && "border-brand/25", className)}>
      {hero && (
        <>
          <span aria-hidden className="bg-brand-metal absolute inset-x-0 top-0 h-[3px]" />
          <span aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-[radial-gradient(closest-side,rgb(255_106_0/0.16),transparent)]" />
        </>
      )}
      <div className="relative flex items-center justify-between gap-3 px-5 pt-4">
        <span className="flex items-center gap-2">
          {Icon &&
            (hero ? (
              <span className="bg-brand-metal flex size-6 items-center justify-center rounded-md text-primary-foreground shadow-[0_6px_16px_-6px_rgb(255_106_0/0.7)]">
                <Icon className="size-3.5" strokeWidth={2} aria-hidden />
              </span>
            ) : (
              <Icon className="size-3.5 text-brand" strokeWidth={1.75} aria-hidden />
            ))}
          <span className={cn("text-eyebrow", hero && "text-foreground/80")}>{title}</span>
        </span>
        {action}
        {href && !action && (
          <Link
            href={href}
            className="group/link inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-all duration-300 ease-out hover:bg-accent hover:text-foreground"
          >
            {linkLabel}
            <ArrowRight className="size-3 transition-transform duration-300 ease-out group-hover/link:translate-x-0.5" strokeWidth={2} aria-hidden />
          </Link>
        )}
      </div>
      <div className="relative flex flex-1 flex-col px-5 pb-5 pt-3">{children}</div>
    </Card>
  );
}

/** Grand chiffre + unité discrète, ex. « 2 110,000 DT ». */
export function Figure({ value, size = "lg" }: { value: string; size?: "xl" | "lg" | "md" }) {
  const match = /^(.*?)(\s?DT)$/.exec(value);
  const main = match ? match[1] : value;
  const unit = match ? match[2] : null;
  return (
    <p
      className={cn(
        "text-figure leading-none text-foreground",
        size === "xl" && "text-[56px]",
        size === "lg" && "text-[40px]",
        size === "md" && "text-[32px]",
      )}
    >
      {main}
      {unit && <span className="ml-1.5 text-[0.42em] tracking-[0.06em] text-brand">{unit.trim()}</span>}
    </p>
  );
}
