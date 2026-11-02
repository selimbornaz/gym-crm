/**
 * Construit le CRM en serveur autonome pour l'application de bureau, dans server/.
 * S'arrête si un secret (clé service_role, mot de passe, secret de tâche planifiée)
 * se retrouve dans le résultat : Next.js copie par défaut les fichiers .env.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const output = join(here, "server");
const dist = join(root, ".next-desktop");

if (!process.argv.includes("--skip-build")) {
  const result = spawnSync("npx", ["next", "build"], {
    cwd: root,
    stdio: "inherit",
    shell: true,
    env: { ...process.env, NEXT_PUBLIC_CASTLE_DESKTOP: "1", NEXT_TELEMETRY_DISABLED: "1", NODE_OPTIONS: "--max-old-space-size=1800" },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

rmSync(output, { recursive: true, force: true });
cpSync(join(dist, "standalone"), output, { recursive: true, dereference: true });
cpSync(join(dist, "static"), join(output, ".next-desktop", "static"), { recursive: true });
if (existsSync(join(root, "public"))) cpSync(join(root, "public"), join(output, "public"), { recursive: true });

// -----------------------------------------------------------------------------
// Aucun secret ni donnée locale dans le logiciel distribué
// -----------------------------------------------------------------------------
const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});

for (const file of walk(output)) {
  const name = file.split(/[\\/]/).pop();
  if (name.startsWith(".env") || name.endsWith(".map")) rmSync(file);
}

const secrets = [];
for (const envFile of [".env", ".env.local"]) {
  const path = join(root, envFile);
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^(SUPABASE_SERVICE_ROLE_KEY|CRON_SECRET|OWNER_PASSWORD|SUPABASE_DB_URL|DATABASE_URL)=(.+)$/);
    if (match) secrets.push(match[2].trim().replace(/^["']|["']$/g, ""));
  }
}

const problems = [];
const files = walk(output);
for (const file of files) {
  const rel = relative(output, file);
  if (/(^|[\\/])(backups|supabase[\\/]tests|scripts)[\\/]/.test(rel) || rel.includes("backup-v1")) problems.push(`fichier inattendu : ${rel}`);
  if (statSync(file).size > 30 * 1024 * 1024) continue;
  const content = readFileSync(file).toString("latin1");
  if (secrets.some((secret) => content.includes(secret))) problems.push(`secret trouvé dans ${rel}`);
}
if (problems.length) {
  console.error(problems.join("\n"));
  rmSync(output, { recursive: true, force: true });
  process.exit(1);
}
const total = files.reduce((n, f) => n + statSync(f).size, 0);
console.log(`Serveur prêt : ${files.length} fichiers, ${Math.round(total / 1024 / 1024)} Mo, ${secrets.length} secrets vérifiés, aucun trouvé.`);
