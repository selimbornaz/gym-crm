import * as React from "react";
import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "flex min-h-16 w-full rounded-lg border border-input bg-card px-3 py-2 text-[13px] text-foreground shadow-card",
        "placeholder:text-subtle-foreground transition-all duration-300 ease-out hover:border-border-strong",
        "focus-visible:border-ring focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15 disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
