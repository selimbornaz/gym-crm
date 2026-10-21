/**
 * Création sécurisée de la première salle et de son propriétaire.
 *
 * À exécuter UNE FOIS, en local, par l'administrateur technique :
 *
 *   npm run bootstrap:owner -- --email proprio@salle.tn --name "Prénom Nom" \
 *     --org "Ma Salle" --slug ma-salle [--default-plans]
 *
 * - Lit NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY dans .env.local.
 * - Si OWNER_PASSWORD est défini (variable d'environnement, jamais en argument
 *   pour ne pas laisser de trace dans l'historique du terminal), crée le compte
 *   avec ce mot de passe ; sinon envoie une INVITATION par email.
 * - Idempotent : relancer le script ne crée ni doublon de salle ni de compte.
 */
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";

for (const file of [".env.local", ".env"]) if (existsSync(file)) process.loadEnvFile(file);

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    org: { type: "string" },
    slug: { type: "string" },
    "default-plans": { type: "boolean", default: false },
  },
});

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const email = values.email?.trim().toLowerCase() ?? fail("--email requis");
const fullName = values.name?.trim() ?? fail("--name requis");
const orgName = values.org?.trim() ?? fail("--org requis");
const slug = values.slug?.trim() ?? fail("--slug requis (lettres minuscules, chiffres, tirets)");
if (!/^[a-z0-9-]{3,60}$/.test(slug)) fail("slug invalide");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? fail("NEXT_PUBLIC_SUPABASE_URL manquant");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? fail("SUPABASE_SERVICE_ROLE_KEY manquant");
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const DEFAULT_PLANS = [
  { name: "Mensuel", kind: "membership", duration_value: 1, duration_unit: "month", price: "80.000", sort_order: 1 },
  { name: "Trimestriel", kind: "membership", duration_value: 3, duration_unit: "month", price: "220.000", sort_order: 2 },
  { name: "Semestriel", kind: "membership", duration_value: 6, duration_unit: "month", price: "420.000", sort_order: 3 },
  { name: "Annuel", kind: "membership", duration_value: 1, duration_unit: "year", price: "780.000", sort_order: 4 },
  { name: "Pass journée", kind: "pass", duration_value: 1, duration_unit: "day", price: "10.000", sort_order: 5 },
  { name: "Pass semaine", kind: "pass", duration_value: 1, duration_unit: "week", price: "30.000", sort_order: 6 },
  { name: "Pack coaching 10 séances", kind: "pt_package", duration_value: 3, duration_unit: "month", price: "350.000", sessions_included: 10, sort_order: 7 },
];

async function findOrCreateUser(): Promise<string> {
  const { data: existing } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
  if (existing) {
    console.log(`• Compte existant réutilisé (${email})`);
    return existing.id as string;
  }

  const password = process.env.OWNER_PASSWORD;
  if (password) {
    if (password.length < 10) fail("OWNER_PASSWORD : 10 caractères minimum");
    const { data, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { full_name: fullName },
    });
    if (error || !data.user) fail(`Création du compte : ${error?.message}`);
    console.log(`• Compte créé avec mot de passe (${email})`);
    return data.user.id;
  }

  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
    redirectTo: `${siteUrl}/auth/confirm?next=/update-password`,
  });
  if (error || !data.user) fail(`Invitation : ${error?.message}`);
  console.log(`• Invitation envoyée à ${email} (lien pour choisir le mot de passe)`);
  return data.user.id;
}

async function main() {
  const userId = await findOrCreateUser();

  let { data: org } = await admin.from("organizations").select("id").eq("slug", slug).maybeSingle();
  if (!org) {
    const res = await admin.from("organizations").insert({ name: orgName, slug }).select("id").single();
    if (res.error) fail(`Création de la salle : ${res.error.message}`);
    org = res.data;
    console.log(`• Salle créée : ${orgName} (${slug})`);
  } else {
    console.log(`• Salle existante réutilisée : ${slug}`);
  }
  const orgId = org!.id as string;

  const { error: staffError } = await admin
    .from("staff")
    .upsert({ organization_id: orgId, user_id: userId, role: "owner", is_active: true }, { onConflict: "organization_id,user_id" });
  if (staffError) fail(`Rattachement du propriétaire : ${staffError.message}`);
  console.log("• Rôle propriétaire attribué");

  if (values["default-plans"]) {
    const { error } = await admin
      .from("membership_plans")
      .upsert(DEFAULT_PLANS.map((p) => ({ ...p, organization_id: orgId })), { onConflict: "organization_id,name", ignoreDuplicates: true });
    if (error) fail(`Formules : ${error.message}`);
    console.log(`• ${DEFAULT_PLANS.length} formules par défaut ajoutées (modifiables dans Paramètres)`);
  }

  console.log(`\n✓ Terminé. Connexion : ${siteUrl}/login`);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
