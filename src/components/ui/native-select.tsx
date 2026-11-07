import * as React from "react";
import { cn } from "@/lib/utils";

/** Select natif stylé : accessible et mobile-friendly sans dépendance Radix. */
export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "flex h-10 w-full rounded-xl border border-input bg-card px-3 text-[13.5px] text-foreground",
        "transition-all duration-300 ease-out hover:border-border-strong",
        "focus-visible:border-ring focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15",
        "disabled:opacity-50 aria-invalid:border-danger",
        className,
      )}
      {...props}
    />
  );
}
