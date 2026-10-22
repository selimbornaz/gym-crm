import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Surface de base : bordure 1 px, ombre douce, arête lumineuse en dark mode.
 * `interactive` ajoute le halo et l'élévation au survol (cartes cliquables).
 */
export function Card({ className, interactive = false, children, ...props }: React.ComponentProps<"div"> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        "edge-highlight relative rounded-xl border bg-card text-card-foreground shadow-card",
        interactive && "group transition-all duration-300 ease-out hover:-translate-y-px hover:border-border-strong hover:shadow-card-hover",
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
  return <div className={cn("flex flex-col gap-1 p-5 pb-3", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return <h3 className={cn("text-[13px] font-medium leading-none tracking-[-0.01em] text-foreground", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("text-xs leading-relaxed text-muted-foreground", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("p-5 pt-0", className)} {...props} />;
}
