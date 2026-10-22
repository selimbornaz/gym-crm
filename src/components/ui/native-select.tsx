import * as React from "react";
import { cn } from "@/lib/utils";

/** Select natif stylé : accessible et mobile-friendly sans dépendance Radix. */
export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "flex h-9 w-full rounded-lg border border-input bg-card px-3 text-[13px] text-foreground shadow-card",
        "transition-all duration-300 ease-out hover:border-border-strong",
        "focus-visible:border-ring focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15",
        "disabled:opacity-50 aria-invalid:border-danger",
        className,
      )}
      {...props}
    />
  );
}
