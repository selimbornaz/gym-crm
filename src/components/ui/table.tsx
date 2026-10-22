import * as React from "react";
import { cn } from "@/lib/utils";

/** Tableau responsive : défilement horizontal sur petit écran plutôt que débordement. */
export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="edge-highlight w-full overflow-x-auto rounded-xl border bg-card shadow-card">
      <table className={cn("w-full caption-bottom text-[13px]", className)} {...props} />
    </div>
  );
}

export function THead({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead className={cn("border-b text-left", className)} {...props} />;
}

export function TBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("divide-y divide-border/70", className)} {...props} />;
}

export function Tr({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr className={cn("transition-colors duration-300 ease-out hover:bg-accent/40", className)} {...props} />;
}

export function Th({ className, ...props }: React.ComponentProps<"th">) {
  return <th className={cn("text-eyebrow h-10 whitespace-nowrap px-4 font-medium", className)} {...props} />;
}

export function Td({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("px-4 py-3 align-middle", className)} {...props} />;
}
