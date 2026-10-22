import { cn } from "@/lib/utils";

/** Teintes douces et stables par personne (dérivées du nom), jamais saturées. */
const TINTS = [
  "bg-indigo-500/12 text-indigo-700 dark:text-indigo-300",
  "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  "bg-amber-500/14 text-amber-700 dark:text-amber-300",
  "bg-sky-500/12 text-sky-700 dark:text-sky-300",
  "bg-rose-500/12 text-rose-700 dark:text-rose-300",
  "bg-violet-500/12 text-violet-700 dark:text-violet-300",
];

function tintFor(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TINTS[h % TINTS.length]!;
}

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

/** Avatar à initiales (pas de photo stockée pour les prospects/coachs). */
export function InitialsAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      title={name}
      className={cn(
        "inline-flex size-8 shrink-0 select-none items-center justify-center rounded-full text-[11px] font-semibold tracking-[0.02em] ring-1 ring-inset ring-black/5 dark:ring-white/10",
        tintFor(name),
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}

/**
 * Pile d'avatars superposés avec compteur de débordement (« +3 »).
 * L'anneau de la couleur de surface sépare proprement chaque avatar.
 */
export function AvatarStack({ names, max = 3, size = "size-6", label }: { names: string[]; max?: number; size?: string; label?: string }) {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  if (names.length === 0) return null;
  return (
    <span className="flex items-center -space-x-1.5" aria-label={label ?? names.join(", ")} role="img">
      {shown.map((n, i) => (
        <InitialsAvatar key={`${n}-${i}`} name={n} className={cn(size, "text-[9px] ring-2 ring-card")} />
      ))}
      {extra > 0 && (
        <span className={cn(size, "inline-flex items-center justify-center rounded-full bg-secondary text-[9px] font-semibold text-muted-foreground ring-2 ring-card")}>
          +{extra}
        </span>
      )}
    </span>
  );
}
