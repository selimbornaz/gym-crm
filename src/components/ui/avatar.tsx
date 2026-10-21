import { cn } from "@/lib/utils";

/** Avatar à initiales (pas de photo stockée pour les prospects/coachs). */
export function InitialsAvatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");

  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium text-secondary-foreground",
        className,
      )}
    >
      {initials}
    </span>
  );
}
