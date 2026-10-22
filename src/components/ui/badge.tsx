import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Badges translucides : fond à 10 %, anneau à 20 %, texte saturé.
 * Jamais d'aplat vif ; la couleur d'un statut est toujours doublée d'un libellé.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4 tracking-[0.01em] ring-1 ring-inset transition-colors duration-300 ease-out",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground ring-transparent",
        secondary: "bg-secondary text-secondary-foreground ring-border",
        outline: "bg-transparent text-muted-foreground ring-border",
        success: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-400",
        warning: "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-400",
        danger: "bg-red-500/10 text-red-700 ring-red-500/20 dark:text-red-400",
        info: "bg-indigo-500/10 text-indigo-700 ring-indigo-500/20 dark:text-indigo-300",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

const DOT: Partial<Record<BadgeVariant, string>> = {
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
  info: "bg-indigo-500",
};

export function Badge({
  className,
  variant,
  dot = false,
  children,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { dot?: boolean }) {
  const dotClass = variant ? DOT[variant] : undefined;
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot && dotClass && <span aria-hidden className={cn("size-1.5 rounded-full", dotClass)} />}
      {children}
    </span>
  );
}
