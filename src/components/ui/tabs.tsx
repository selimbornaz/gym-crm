"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;

/** Onglets soulignés (style Linear) : une ligne de 1 px, l'onglet actif porte un trait de 2 px. */
export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        // Ligne de base en ombre interne : pas de débordement vertical, donc pas de barre de défilement parasite.
        "flex max-w-full items-center gap-5 overflow-x-auto overflow-y-hidden text-muted-foreground shadow-[inset_0_-1px_0_var(--border)] [scrollbar-width:none]",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "relative inline-flex h-10 items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent text-[13px] font-medium tracking-[-0.01em]",
        "transition-all duration-300 ease-out hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "data-[state=active]:border-foreground data-[state=active]:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

/** Compteur discret à placer dans un onglet (« Paiements 12 »). */
export function TabsCount({ children }: { children: React.ReactNode }) {
  return <span className="rounded-md bg-secondary px-1.5 text-[11px] font-medium tabular-nums leading-5 text-muted-foreground">{children}</span>;
}

export function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn("mt-5 focus-visible:outline-none", className)} {...props} />;
}
