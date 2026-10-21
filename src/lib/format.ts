/**
 * Formatage monétaire (dinar tunisien, 3 décimales) et dates (Africa/Tunis).
 * Les montants circulent en chaînes décimales ("90.000") entre la base et
 * l'interface : aucune arithmétique flottante sur l'argent côté application.
 */
export const TIME_ZONE = "Africa/Tunis";
export const LOCALE = "fr-TN";

const tndFormatter = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: "TND",
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

const tndCompact = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: "TND",
  notation: "compact",
  maximumFractionDigits: 1,
});

/** "90.5" | 90.5 -> "90,500 DT". Affichage uniquement. */
export function formatMoney(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return tndFormatter.format(Number(value));
}

export function formatMoneyCompact(value: string | number): string {
  return tndCompact.format(Number(value));
}

/**
 * Normalise une saisie utilisateur ("12,5", "1 200.75") en décimal "12.500".
 * Renvoie null si invalide (plus de 3 décimales, négatif, texte...).
 */
export function normalizeAmount(input: string): string | null {
  const cleaned = input.replace(/[\s ]/g, "").replace(",", ".");
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(cleaned)) return null;
  const [int, dec = ""] = cleaned.split(".");
  return `${Number(int)}.${dec.padEnd(3, "0")}`;
}

/** Somme exacte de montants décimaux (via millimes entiers). */
export function sumAmounts(values: Array<string | number>): string {
  const millimes = values.reduce<number>((acc, v) => acc + Math.round(Number(v) * 1000), 0);
  return (millimes / 1000).toFixed(3);
}

// ------------------------------------------------------------------ dates --

const dateFmt = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, day: "2-digit", month: "2-digit", year: "numeric" });
const dateLongFmt = new Intl.DateTimeFormat("fr-FR", { timeZone: TIME_ZONE, weekday: "long", day: "numeric", month: "long", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
});
const timeFmt = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" });

/** Une date SQL "2026-10-22" représente un jour civil : on l'affiche sans conversion de fuseau. */
function parseDateOnly(value: string): Date {
  return new Date(`${value}T12:00:00Z`);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? parseDateOnly(value) : new Date(value);
  return dateFmt.format(d);
}

export function formatDateLong(value: string | Date): string {
  const d = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? parseDateOnly(value) : new Date(value);
  return dateLongFmt.format(d);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  return value ? dateTimeFmt.format(new Date(value)) : "—";
}

export function formatTime(value: string | Date | null | undefined): string {
  return value ? timeFmt.format(new Date(value)) : "—";
}

/** Date du jour à Tunis au format "YYYY-MM-DD". */
export function todayInTunis(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(now);
}

/** Ajoute des jours à une date "YYYY-MM-DD". */
export function addDaysIso(isoDate: string, days: number): string {
  const d = parseDateOnly(isoDate);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Décalage (minutes) du fuseau à un instant donné, ex. +60 pour Tunis. */
function tzOffsetMinutes(at: Date, timeZone = TIME_ZONE): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(at).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!);
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** "2026-10-22T18:30" saisi à Tunis -> instant ISO UTC. */
export function tunisLocalToIso(local: string): string {
  const guess = new Date(`${local}:00Z`);
  return new Date(guess.getTime() - tzOffsetMinutes(guess) * 60_000).toISOString();
}

/** Instant ISO -> "2026-10-22T18:30" (heure de Tunis) pour un <input type="datetime-local">. */
export function isoToTunisLocal(iso: string): string {
  const d = new Date(iso);
  return new Date(d.getTime() + tzOffsetMinutes(d) * 60_000).toISOString().slice(0, 16);
}
