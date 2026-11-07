import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Surface de verre : fond translucide flouté, bordure 1 px, arête lumineuse.
 * `interactive` ajoute le halo et l'élévation au survol (cartes cliquables).
 */
export function Card({ className, interactive = false, children, ...props }: React.ComponentProps<"div"> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        "glass relative rounded-2xl border bg-card text-card-foreground shadow-card",
        interactive && "group transition-[transform,box-shadow,border-color] duration-500 ease-out-soft hover:-translate-y-0.5 hover:border-border-strong hover:shadow-card-hover",
        className,
      )}
      {...props}
    >
      {interactive && <span aria-hidden className="glow-on-hover" />}
      {children}
    </div>
  );
}

export function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1.5 p-6 pb-4", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return <h3 className={cn("text-[15px] font-semibold leading-tight tracking-[-0.015em] text-foreground", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("text-[13px] leading-relaxed text-muted-foreground", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("p-6 pt-0", className)} {...props} />;
}
