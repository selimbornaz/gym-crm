/**
 * Réinitialise le mot de passe d'un compte existant sans passer par l'email.
 *
 *   npm run reset:password -- --email proprio@salle.tn
 *
 * - Lit NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY dans .env.local.
 * - Le nouveau mot de passe vient de OWNER_PASSWORD (jamais en argument, pour
 *   ne pas laisser de trace dans l'historique du terminal). Videz la variable
 *   après usage.
 */
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";

for (const file of [".env.local", ".env"]) if (existsSync(file)) process.loadEnvFile(file);

const { values } = parseArgs({ options: { email: { type: "string" } } });

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const email = values.email?.trim().toLowerCase() ?? fail("--email requis");
const password = process.env.OWNER_PASSWORD ?? "";
if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
  fail("OWNER_PASSWORD : 10 caractères minimum, avec au moins une lettre et un chiffre");
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? fail("NEXT_PUBLIC_SUPABASE_URL manquant");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? fail("SUPABASE_SERVICE_ROLE_KEY manquant");
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function main() {
  const { data: profile } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
  if (!profile) fail(`Aucun compte pour ${email}`);

  const { error } = await admin.auth.admin.updateUserById(profile.id as string, { password });
  if (error) fail(`Mise à jour : ${error.message}`);
  console.log(`✓ Mot de passe mis à jour pour ${email}. Pensez à vider OWNER_PASSWORD dans .env.local.`);
}

main().catch((e) => fail(String(e)));
