/**
 * Génère src/lib/offline/columns.generated.ts depuis le schéma réel : colonnes et
 * valeurs par défaut des tables, pour qu'une ligne créée hors ligne ait la même
 * forme qu'une ligne du serveur. offline-local.ts vérifie que le fichier reste à jour.
 *
 *   TEST_DATABASE_URL=... npx tsx supabase/tests/generate-columns.ts
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const root = join(__dirname, "..");
const TARGET = join(root, "..", "src", "lib", "offline", "columns.generated.ts");

export type ColumnDefault = { name: string; value: unknown; generated?: true };

function parseDefault(expr: string | null): unknown {
  if (expr === null) return null;
  const literal = expr.match(/^'((?:[^']|'')*)'::/);
  if (literal) {
    const text = literal[1]!.replace(/''/g, "'");
    if (/::jsonb?$/.test(expr)) return JSON.parse(text);
    if (/\[\]$/.test(expr)) return text === "{}" ? [] : text.slice(1, -1).split(",");
    return text;
  }
  if (/^ARRAY\[/.test(expr)) return [...expr.matchAll(/'([^']*)'::/g)].map((m) => m[1]);
  if (expr === "true") return true;
  if (expr === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(expr)) return Number(expr);
  // now(), gen_random_uuid(), auth.uid(), identités : renseignés à la création de la ligne.
  return null;
}

export async function readColumns(db: Client, tables: string[]): Promise<Record<string, ColumnDefault[]>> {
  const { rows } = await db.query(
    `select table_name, column_name, column_default, is_generated from information_schema.columns
     where table_schema = 'public' and table_name = any($1) order by table_name, ordinal_position`, [tables]);
  const out: Record<string, ColumnDefault[]> = {};
  for (const r of rows) {
    (out[r.table_name] ??= []).push({
      name: r.column_name,
      value: parseDefault(r.column_default),
      ...(r.is_generated === "ALWAYS" ? { generated: true as const } : {}),
    });
  }
  return out;
}

export function renderColumns(columns: Record<string, ColumnDefault[]>): string {
  return `// Généré par supabase/tests/generate-columns.ts : ne pas modifier à la main.
export interface ColumnDefault {
  name: string;
  value: unknown;
  generated?: true;
}

export const TABLE_COLUMNS: Record<string, ColumnDefault[]> = ${JSON.stringify(columns, null, 2)};
`;
}

export const WRITABLE_TABLES = [
  "organizations", "organization_settings", "coaches", "members", "member_notes", "leads", "membership_plans",
  "subscriptions", "subscription_events", "payment_methods", "payments", "payment_adjustments", "expenses", "attendance",
  "workout_programs", "workout_days", "workout_exercises", "workout_logs", "progress_entries", "sessions", "bookings",
  "equipment", "equipment_maintenance", "notifications", "announcements",
];

async function main() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://gym:gym@localhost:5432/postgres";
  const admin = new Client({ connectionString: url });
  await admin.connect();
  const name = "gym_crm_columns";
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
  await admin.end();
  const u = new URL(url);
  u.pathname = `/${name}`;
  const db = new Client({ connectionString: u.toString() });
  await db.connect();
  await db.query(readFileSync(join(root, "tests", "supabase_stub.sql"), "utf8"));
  for (const f of readdirSync(join(root, "migrations")).filter((x) => x.endsWith(".sql")).sort()) {
    await db.query(readFileSync(join(root, "migrations", f), "utf8"));
  }
  writeFileSync(TARGET, renderColumns(await readColumns(db, WRITABLE_TABLES)));
  await db.end();
  console.log(`Écrit : ${TARGET}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
