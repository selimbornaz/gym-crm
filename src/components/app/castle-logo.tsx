import { cn } from "@/lib/utils";

/** Rouge officiel du logo : fixe, quel que soit le thème (écran et impression). */
const LOGO_RED = "#e8262a";

/** Logo Castle (couronne, C et G) en vectoriel : net à toutes les tailles. */
export function CastleLogo({ className, title = "Castle" }: { className?: string; title?: string }) {
  return (
    <svg viewBox="428 445 629 1031" fill={LOGO_RED} role="img" aria-label={title} className={cn("h-9 w-auto shrink-0", className)}>
      <polygon points="742,445 847,505 847,605 965,673 965,574 1057,627 1057,829 742,648 428,829 428,627 518,574 518,673 637,605 637,505" />
      <polygon points="742,750 1056,932 961,987 742,862 525,987 525,1240 742,1364 961,1239 1056,1294 742,1476 428,1295 428,931" />
      <polygon points="742,965 871,1039 833,1062 742,1010 653,1062 653,1165 742,1216 833,1165 833,1138 741,1138 741,1097 873,1097 873,1188 742,1262 613,1188 613,1039" />
    </svg>
  );
}

/** Nom de la salle en capitales très espacées, à associer au logo. */
export function CastleWordmark({ className }: { className?: string }) {
  return <span className={cn("font-semibold uppercase tracking-[0.3em]", className)}>Castle</span>;
}
