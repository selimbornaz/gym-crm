import * as React from "react";
import { cn } from "@/lib/utils";

/** Tableau responsive : défilement horizontal sur petit écran plutôt que débordement. */
export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto rounded-xl border bg-card">
      <table className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  );
}

export function THead({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead className={cn("border-b bg-muted/40 text-left", className)} {...props} />;
}

export function TBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("divide-y", className)} {...props} />;
}

export function Tr({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr className={cn("transition-colors hover:bg-muted/30", className)} {...props} />;
}

export function Th({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      className={cn("h-10 whitespace-nowrap px-4 text-xs font-medium uppercase tracking-wide text-muted-foreground", className)}
      {...props}
    />
  );
}

export function Td({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("px-4 py-3 align-middle", className)} {...props} />;
}
