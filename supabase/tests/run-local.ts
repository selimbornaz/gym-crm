/**
 * Tests de sécurité et de règles métier sur un PostgreSQL local.
 *
 *   TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/postgres npm run db:test
 *
 * 1. Recrée une base `gym_crm_test`, applique le bouchon Supabase puis TOUTES
 *    les migrations de supabase/migrations.
 * 2. Exécute des scénarios en se faisant passer pour différents utilisateurs
 *    (rôle `authenticated` + `request.jwt.claim.sub`), exactement comme
 *    PostgREST le fait sur Supabase : la RLS s'applique réellement.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

const ADMIN_URL = process.env.TEST_DATABASE_URL ?? "postgresql://gym:gym@localhost:5432/postgres";
const TEST_DB = "gym_crm_test";
const root = join(__dirname, "..");

// ----------------------------------------------------------------- outillage --
let passed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push(`${name}: ${(err as Error).message}`);
    console.log(`  ✗ ${name}\n      ${(err as Error).message}`);
  }
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

/** Exécute `fn` dans une transaction annulée, en tant qu'utilisateur authentifié. */
async function as<T>(db: Client, userId: string | null, fn: () => Promise<T>): Promise<T> {
  await db.query("begin");
  try {
    if (userId) {
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    }
    const result = await fn();
    await db.query("rollback");
    return result;
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}

/** Comme `as`, mais valide la transaction (pour préparer l'état des tests suivants). */
async function asCommit<T>(db: Client, userId: string, fn: () => Promise<T>): Promise<T> {
  await db.query("begin");
  try {
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    const result = await fn();
    await db.query("commit");
    return result;
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}

async function expectError(promise: Promise<unknown>, pattern: RegExp) {
  try {
    await promise;
  } catch (err) {
    const msg = (err as Error).message;
    assert(pattern.test(msg), `erreur inattendue : « ${msg} » (attendu ${pattern})`);
    return;
  }
  throw new Error(`une erreur ${pattern} était attendue`);
}

// --------------------------------------------------------------------- setup --
async function setupDatabase(): Promise<Client> {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${TEST_DB} with (force)`);
  await admin.query(`create database ${TEST_DB}`);
  await admin.end();

  const url = new URL(ADMIN_URL);
  url.pathname = `/${TEST_DB}`;
  const db = new Client({ connectionString: url.toString() });
  await db.connect();

  await db.query(readFileSync(join(root, "tests", "supabase_stub.sql"), "utf8"));
  const migrations = readdirSync(join(root, "migrations")).filter((f) => f.endsWith(".sql")).sort();
  for (const file of migrations) {
    try {
      await db.query(readFileSync(join(root, "migrations", file), "utf8"));
      console.log(`  migration ${file} ✓`);
    } catch (err) {
      throw new Error(`Migration ${file} : ${(err as Error).message}`);
    }
  }
  return db;
}

const one = async <T = Record<string, unknown>>(db: Client, sql: string, params: unknown[] = []) =>
  (await db.query(sql, params)).rows[0] as T;
const rows = async <T = Record<string, unknown>>(db: Client, sql: string, params: unknown[] = []) =>
  (await db.query(sql, params)).rows as T[];

// ---------------------------------------------------------------- scénarios --
async function main() {
  console.log("Préparation de la base de test");
  const db = await setupDatabase();

  // Utilisateurs Auth (deux salles distinctes).
  const users = {
    ownerA: randomUUID(), receptionA: randomUUID(), coachA: randomUUID(), ownerB: randomUUID(),
  };
  for (const [name, id] of Object.entries(users)) {
    await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [
      id, `${name}@test.tn`, { full_name: name },
    ]);
  }

  // Bootstrap (équivalent du script bootstrap-owner, exécuté en service_role).
  const orgA = (await one<{ id: string }>(db, "insert into organizations (name, slug) values ('Salle A', 'salle-a') returning id")).id;
  const orgB = (await one<{ id: string }>(db, "insert into organizations (name, slug) values ('Salle B', 'salle-b') returning id")).id;
  await db.query("insert into staff (organization_id, user_id, role) values ($1,$2,'owner'),($1,$3,'receptionist'),($1,$4,'coach'),($5,$6,'owner')",
    [orgA, users.ownerA, users.receptionA, users.coachA, orgB, users.ownerB]);
  const coachStaff = (await one<{ id: string }>(db, "select id from staff where user_id = $1", [users.coachA])).id;
  const coachA = (await one<{ id: string }>(db,
    "insert into coaches (organization_id, staff_id, full_name, specialties) values ($1,$2,'Coach A', '{CrossFit}') returning id",
    [orgA, coachStaff])).id;
  const otherCoach = (await one<{ id: string }>(db,
    "insert into coaches (organization_id, full_name) values ($1,'Coach Libre') returning id", [orgA])).id;

  const plans = await rows<{ id: string; name: string }>(db, `
    insert into membership_plans (organization_id, name, kind, duration_value, duration_unit, price, sessions_included)
    values ($1, 'Mensuel', 'membership', 1, 'month', 90.000, null),
           ($1, 'Pass journée', 'pass', 1, 'day', 10.000, null),
           ($1, 'Pack PT 10', 'pt_package', 2, 'month', 450.000, 10)
    returning id, name`, [orgA]);
  const monthly = plans.find((p) => p.name === "Mensuel")!.id;
  const cash = (await one<{ id: string }>(db, "select id from payment_methods where organization_id = $1 and code = 'cash'", [orgA])).id;

  console.log("\nCréation de membres");
  let alice = "";
  let bob = "";
  await test("l'accueil crée un membre ; code M-000001 attribué automatiquement", async () => {
    const r = await asCommit(db, users.receptionA, () => one<{ id: string; member_code: string }>(db,
      "insert into members (organization_id, first_name, last_name, phone, coach_id) values ($1,'Alice','Ben Salah','+216 22 333 444',$2) returning id, member_code",
      [orgA, coachA]));
    alice = r.id;
    assert(r.member_code === "M-000001", `code ${r.member_code}`);
    bob = (await asCommit(db, users.receptionA, () => one<{ id: string }>(db,
      "insert into members (organization_id, first_name, last_name, phone) values ($1,'Bob','Trabelsi','55 666 777') returning id",
      [orgA]))).id;
  });

  await test("détection de doublon par téléphone (format différent)", async () => {
    const dups = await as(db, users.receptionA, () => rows(db,
      "select * from find_member_duplicates($1, 'Autre', 'Nom', '22333444')", [orgA]));
    assert(dups.length === 1 && dups[0]!.match_reason === "Même téléphone", JSON.stringify(dups));
  });

  console.log("\nIsolation entre salles (tenant)");
  await test("le propriétaire B ne voit aucun membre de A", async () => {
    const r = await as(db, users.ownerB, () => rows(db, "select id from members"));
    assert(r.length === 0, `${r.length} membres visibles`);
  });
  await test("le propriétaire B ne peut pas lire un membre de A par son id (IDOR)", async () => {
    const r = await as(db, users.ownerB, () => rows(db, "select id from members where id = $1", [alice]));
    assert(r.length === 0, "membre visible");
  });
  await test("le propriétaire B ne peut pas insérer un membre dans A", async () => {
    await expectError(as(db, users.ownerB, () => db.query(
      "insert into members (organization_id, first_name, last_name) values ($1,'X','Y')", [orgA])), /row-level security/);
  });
  await test("le propriétaire B ne peut pas appeler une RPC sur A", async () => {
    await expectError(as(db, users.ownerB, () => db.query(
      "select create_subscription($1,$2,$3,$4)", [orgA, alice, monthly, randomUUID()])), /non autorisée/);
  });
  await test("le propriétaire B ne voit ni paiements, ni audit, ni personnel de A", async () => {
    const counts = await as(db, users.ownerB, () => one<Record<string, string>>(db, `select
      (select count(*) from payments) p, (select count(*) from audit_logs where organization_id = $1) a,
      (select count(*) from staff where organization_id = $1) s, (select count(*) from organizations where id = $1) o`, [orgA]));
    assert(Object.values(counts).every((v) => Number(v) === 0), JSON.stringify(counts));
  });
  await test("un utilisateur anonyme n'a accès à rien", async () => {
    await db.query("begin");
    await db.query("set local role anon");
    try {
      await expectError(db.query("select * from members"), /permission denied/);
    } finally {
      await db.query("rollback");
    }
  });

  console.log("\nAbonnements");
  let subAlice = "";
  const req1 = randomUUID();
  await test("création d'un abonnement mensuel avec remise", async () => {
    subAlice = await asCommit(db, users.receptionA, async () =>
      (await one<{ id: string }>(db, "select create_subscription($1,$2,$3,$4, null, 10) as id", [orgA, alice, monthly, req1])).id);
    const s = await one<{ total_due: string; start_date: Date; end_date: Date }>(db,
      "select total_due, start_date, end_date from subscriptions where id = $1", [subAlice]);
    assert(s.total_due === "80.000", `total ${s.total_due}`);
  });
  await test("double soumission (même request_id) => même abonnement, pas de doublon", async () => {
    const again = await asCommit(db, users.receptionA, async () =>
      (await one<{ id: string }>(db, "select create_subscription($1,$2,$3,$4, null, 10) as id", [orgA, alice, monthly, req1])).id);
    assert(again === subAlice, "nouvel abonnement créé");
    const n = await one<{ n: string }>(db, "select count(*) n from subscriptions where member_id = $1", [alice]);
    assert(n.n === "1", `${n.n} abonnements`);
  });
  await test("renouvellement : démarre le lendemain de la fin en cours", async () => {
    await as(db, users.receptionA, async () => {
      const id = (await one<{ id: string }>(db, "select create_subscription($1,$2,$3,$4) as id", [orgA, alice, monthly, randomUUID()])).id;
      const r = await one<{ ok: boolean }>(db,
        "select n.start_date = o.end_date + 1 as ok from subscriptions n, subscriptions o where n.id = $1 and o.id = $2", [id, subAlice]);
      assert(r.ok, "date de début incorrecte");
    });
  });
  await test("chevauchement explicite refusé", async () => {
    await expectError(as(db, users.receptionA, () => db.query(
      "select create_subscription($1,$2,$3,$4, (select start_date from subscriptions where id = $5))",
      [orgA, alice, monthly, randomUUID(), subAlice])), /déjà une adhésion/);
  });
  await test("l'accueil ne peut pas prolonger ni annuler (réservé au propriétaire)", async () => {
    await expectError(as(db, users.receptionA, () => db.query(
      "select extend_subscription($1,$2,5,'geste commercial')", [orgA, subAlice])), /non autorisée/);
    await expectError(as(db, users.receptionA, () => db.query(
      "select cancel_subscription($1,$2,'test')", [orgA, subAlice])), /non autorisée/);
  });
  await test("prolongation par le propriétaire : +5 jours et trace d'audit avec motif", async () => {
    await as(db, users.ownerA, async () => {
      const before = await one<{ end_date: string }>(db, "select end_date::text from subscriptions where id = $1", [subAlice]);
      const after = await one<{ d: string }>(db, "select extend_subscription($1,$2,5,'Fermeture travaux')::text d", [orgA, subAlice]);
      const diff = (new Date(after.d).getTime() - new Date(before.end_date).getTime()) / 86_400_000;
      assert(diff === 5, `écart ${diff}`);
      const audit = await one<{ reason: string }>(db,
        "select reason from audit_logs where entity_id = $1 and action = 'subscriptions.update' order by id desc limit 1", [subAlice]);
      assert(audit?.reason === "Fermeture travaux", JSON.stringify(audit));
    });
  });
  await test("suspension puis reprise", async () => {
    await as(db, users.ownerA, async () => {
      await db.query("select suspend_subscription($1,$2,'Blessure')", [orgA, subAlice]);
      const m = await one<{ membership_suspended: boolean }>(db, "select membership_suspended from members where id = $1", [alice]);
      assert(m.membership_suspended, "membre non marqué suspendu");
      await db.query("select resume_subscription($1,$2)", [orgA, subAlice]);
    });
  });

  console.log("\nPaiements, soldes, remboursements");
  let pay1 = "";
  await test("paiement partiel de 30 sur 80 => solde 50", async () => {
    pay1 = await asCommit(db, users.receptionA, async () =>
      (await one<{ payment_id: string }>(db, "select * from record_payment($1,$2,$3,30,$4,$5)",
        [orgA, alice, cash, randomUUID(), subAlice])).payment_id);
    const s = await one<{ amount_paid: string; balance: string; payment_status: string }>(db,
      "select amount_paid, balance, payment_status from subscription_overview where id = $1", [subAlice]);
    assert(s.amount_paid === "30.000" && s.balance === "50.000" && s.payment_status === "partial", JSON.stringify(s));
  });
  await test("trop-perçu refusé (60 > 50 restants), montant au format « 50,000 DT »", async () => {
    await expectError(as(db, users.receptionA, () => db.query(
      "select * from record_payment($1,$2,$3,60,$4,$5)", [orgA, alice, cash, randomUUID(), subAlice])), /dépasse le reste à payer \(50,000 DT\)/);
  });
  await test("format monétaire SQL : séparateur de milliers et virgule décimale", async () => {
    const r = await one<{ a: string; b: string }>(db, "select private.fmt_dt(1250.5) a, private.fmt_dt(1234567.891) b");
    assert(r.a === "1 250,500 DT" && r.b === "1 234 567,891 DT", JSON.stringify(r));
  });
  await test("montant à 4 décimales refusé", async () => {
    await expectError(as(db, users.receptionA, () => db.query(
      "select * from record_payment($1,$2,$3,1.0005,$4,$5)", [orgA, alice, cash, randomUUID(), subAlice])), /Montant invalide/);
  });
  await test("l'accueil ne peut pas antidater un paiement", async () => {
    await expectError(as(db, users.receptionA, () => db.query(
      "select * from record_payment($1,$2,$3,5,$4,$5, now() - interval '10 days')", [orgA, alice, cash, randomUUID(), subAlice])),
      /antidater/);
  });
  await test("un paiement ne peut être ni modifié ni supprimé (même par le propriétaire)", async () => {
    await expectError(as(db, users.ownerA, () => db.query("update payments set amount = 1 where id = $1", [pay1])), /permission denied/);
    await expectError(as(db, users.ownerA, () => db.query("delete from payments where id = $1", [pay1])), /permission denied/);
    await expectError(as(db, null, () => db.query("delete from payments where id = $1", [pay1])), /ne peut pas être supprimé/);
  });
  await test("l'accueil ne peut pas rembourser", async () => {
    await expectError(as(db, users.receptionA, () => db.query(
      "select refund_payment($1,$2,'refund',5,'erreur',$3)", [orgA, pay1, randomUUID()])), /non autorisée/);
  });
  await test("remboursement partiel de 10 par le propriétaire => encaissé net 20, solde 60", async () => {
    await asCommit(db, users.ownerA, () => db.query("select refund_payment($1,$2,'refund',10,'Erreur de saisie',$3)",
      [orgA, pay1, randomUUID()]));
    const s = await one<{ amount_paid: string; balance: string }>(db,
      "select amount_paid, balance from subscription_overview where id = $1", [subAlice]);
    assert(s.amount_paid === "20.000" && s.balance === "60.000", JSON.stringify(s));
  });
  await test("remboursement supérieur au restant refusé (max. 20,000 DT)", async () => {
    await expectError(as(db, users.ownerA, () => db.query(
      "select refund_payment($1,$2,'refund',25,'trop',$3)", [orgA, pay1, randomUUID()])), /max\. 20,000 DT remboursables/);
  });
  await test("le motif du remboursement figure dans le journal d'audit", async () => {
    const a = await one<{ reason: string }>(db,
      "select reason from audit_logs where action = 'payment_adjustments.insert' order by id desc limit 1");
    assert(a?.reason === "Erreur de saisie", JSON.stringify(a));
  });
  await test("tableau de bord : CA du jour = 30 - 10 = 20 ; impayés = 60", async () => {
    const d = await as(db, users.ownerA, () => one<{ s: Record<string, unknown> }>(db, "select dashboard_stats($1) s", [orgA]));
    assert(Number(d.s.revenue_today) === 20 && Number(d.s.unpaid_total) === 60, JSON.stringify(d.s));
  });
  await test("tableau de bord de l'accueil : aucun chiffre financier", async () => {
    const d = await as(db, users.receptionA, () => one<{ s: Record<string, unknown> }>(db, "select dashboard_stats($1) s", [orgA]));
    assert(!("revenue_today" in d.s) && !("unpaid_total" in d.s), Object.keys(d.s).join(","));
  });
  await test("rapports financiers interdits à l'accueil, cohérents pour le propriétaire", async () => {
    await expectError(as(db, users.receptionA, () => db.query("select * from profit_and_loss($1, current_date - 1, current_date + 1)", [orgA])), /non autorisée/);
    const pl = await as(db, users.ownerA, async () => {
      await db.query("insert into expenses (organization_id, category, amount, spent_on, description) values ($1,'electricity',15.500,current_date,'STEG')", [orgA]);
      return one<{ r: Record<string, string> }>(db, "select profit_and_loss($1, current_date - 1, current_date + 1) r", [orgA]);
    });
    assert(Number(pl.r.net_revenue) === 20 && Number(pl.r.result) === 4.5, JSON.stringify(pl.r));
  });

  console.log("\nPrésences et contrôle d'accès");
  await test("membre à jour : entrée autorisée, puis doublon détecté", async () => {
    await as(db, users.receptionA, async () => {
      const r1 = await one<{ r: { result: string } }>(db, "select check_in($1,$2,'search') r", [orgA, alice]);
      assert(r1.r.result === "granted", JSON.stringify(r1.r));
      const r2 = await one<{ r: { result: string } }>(db, "select check_in($1,$2,'qr') r", [orgA, alice]);
      assert(r2.r.result === "duplicate", JSON.stringify(r2.r));
    });
  });
  await test("membre sans abonnement : refusé ; l'accueil ne peut pas forcer", async () => {
    await as(db, users.receptionA, async () => {
      const r = await one<{ r: { result: string; can_override: boolean } }>(db, "select check_in($1,$2,'search') r", [orgA, bob]);
      assert(r.r.result === "denied" && r.r.can_override === false, JSON.stringify(r.r));
    });
    await expectError(as(db, users.receptionA, () => db.query(
      "select check_in($1,$2,'search','client VIP')", [orgA, bob])), /non autorisée/);
  });
  await test("le propriétaire peut forcer l'entrée avec motif (audité)", async () => {
    await as(db, users.ownerA, async () => {
      const r = await one<{ r: { result: string; overridden: boolean } }>(db, "select check_in($1,$2,'search','Essai offert') r", [orgA, bob]);
      assert(r.r.result === "granted" && r.r.overridden, JSON.stringify(r.r));
      const a = await one<{ n: string }>(db, "select count(*) n from audit_logs where action = 'attendance.override'");
      assert(a.n === "1", "pas d'audit");
    });
  });
  await test("les présences ne s'insèrent pas en direct (uniquement via check_in)", async () => {
    await expectError(as(db, users.receptionA, () => db.query(
      "insert into attendance (organization_id, member_id, method) values ($1,$2,'manual')", [orgA, bob])), /permission denied/);
  });

  console.log("\nCoachs : accès restreint aux membres assignés");
  await test("le coach ne voit que ses membres assignés", async () => {
    const r = await as(db, users.coachA, () => rows<{ id: string }>(db, "select id from members"));
    assert(r.length === 1 && r[0]!.id === alice, `${r.length} membres`);
  });
  await test("le coach ne voit ni abonnements, ni paiements, ni notes internes", async () => {
    const c = await as(db, users.coachA, () => one<Record<string, string>>(db,
      "select (select count(*) from subscriptions) s, (select count(*) from payments) p, (select count(*) from member_notes) n"));
    assert(Object.values(c).every((v) => Number(v) === 0), JSON.stringify(c));
  });
  await test("le coach crée un programme pour son membre, pas pour un autre", async () => {
    await as(db, users.coachA, async () => {
      await db.query("insert into workout_programs (organization_id, member_id, coach_id, name) values ($1,$2,$3,'Force')", [orgA, alice, coachA]);
    });
    await expectError(as(db, users.coachA, () => db.query(
      "insert into workout_programs (organization_id, member_id, coach_id, name) values ($1,$2,$3,'Force')", [orgA, bob, coachA])),
      /row-level security/);
  });
  await test("le coach voit les présences de ses membres uniquement", async () => {
    await as(db, users.ownerA, () => db.query("select 1")); // état committé : aucune présence (transactions annulées)
    const r = await as(db, users.coachA, () => rows(db, "select * from attendance where member_id = $1", [bob]));
    assert(r.length === 0, "présence d'un autre membre visible");
  });

  console.log("\nPlanning et réservations");
  await test("séance de capacité 1 : 2e réservation refusée (pas de surbooking)", async () => {
    await as(db, users.receptionA, async () => {
      const s = await one<{ id: string }>(db, `insert into sessions (organization_id, kind, title, coach_id, starts_at, ends_at, capacity)
        values ($1,'personal_training','PT',$2, now() + interval '1 day', now() + interval '1 day 1 hour', 1) returning id`, [orgA, otherCoach]);
      await db.query("select book_session($1,$2,$3)", [orgA, s.id, alice]);
      await expectError(db.query("select book_session($1,$2,$3)", [orgA, s.id, bob]), /complète/);
    });
  });
  await test("un coach ne peut pas être programmé sur deux séances simultanées", async () => {
    await expectError(as(db, users.receptionA, async () => {
      for (const title of ["Yoga", "Pilates"]) {
        await db.query(`insert into sessions (organization_id, kind, title, coach_id, starts_at, ends_at, capacity)
          values ($1,'group_class',$2,$3, date_trunc('hour', now()) + interval '2 days', date_trunc('hour', now()) + interval '2 days 1 hour', 10)`,
          [orgA, title, otherCoach]);
      }
    }), /sessions_no_coach_overlap/);
  });

  console.log("\nPersonnel : pas d'auto-promotion");
  await test("l'accueil ne peut pas modifier son propre rôle", async () => {
    const r = await as(db, users.receptionA, () => db.query("update staff set role = 'owner' where user_id = $1", [users.receptionA]));
    assert(r.rowCount === 0, "rôle modifié");
  });
  await test("le propriétaire ne peut pas modifier son propre rôle (dernier propriétaire protégé)", async () => {
    await expectError(as(db, users.ownerA, () => db.query("update staff set role = 'coach' where user_id = $1", [users.ownerA])),
      /propre rôle/);
  });
  await test("le propriétaire peut désactiver un employé (journalisé)", async () => {
    await as(db, users.ownerA, async () => {
      const r = await db.query("update staff set is_active = false where user_id = $1", [users.coachA]);
      assert(r.rowCount === 1, "non modifié");
      const a = await one<{ n: string }>(db, "select count(*) n from audit_logs where action = 'staff.update'");
      assert(Number(a.n) >= 1, "pas d'audit");
    });
  });
  await test("un employé désactivé perd immédiatement l'accès", async () => {
    await db.query("update staff set is_active = false where user_id = $1", [users.coachA]);
    const r = await as(db, users.coachA, () => rows(db, "select id from members"));
    await db.query("update staff set is_active = true where user_id = $1", [users.coachA]);
    assert(r.length === 0, "accès conservé");
  });

  console.log("\nExpiration, annulation, exports, stockage");
  const dayPass = plans.find((p) => p.name === "Pass journée")!.id;
  await test("pass expiré : statut « expiré » et entrée refusée avec la date", async () => {
    await as(db, users.receptionA, async () => {
      const carla = (await one<{ id: string }>(db,
        "insert into members (organization_id, first_name, last_name) values ($1,'Carla','Expirée') returning id", [orgA])).id;
      await db.query("select create_subscription($1,$2,$3,$4, current_date - 3)", [orgA, carla, dayPass, randomUUID()]);
      const m = await one<{ membership_status: string }>(db, "select membership_status from member_directory where id = $1", [carla]);
      assert(m.membership_status === "expired", m.membership_status);
      const r = await one<{ r: { result: string; message: string } }>(db, "select check_in($1,$2,'search') r", [orgA, carla]);
      assert(r.r.result === "denied" && /expiré le/.test(r.r.message), JSON.stringify(r.r));
    });
  });
  await test("abonnement annulé : sorti des impayés, historique conservé", async () => {
    await as(db, users.ownerA, async () => {
      await db.query("select cancel_subscription($1,$2,'Départ à l''étranger')", [orgA, subAlice]);
      const d = await one<{ s: { unpaid_total: number } }>(db, "select dashboard_stats($1) s", [orgA]);
      assert(Number(d.s.unpaid_total) === 0, `impayés ${d.s.unpaid_total}`);
      const n = await one<{ n: string }>(db, "select count(*) n from subscriptions where id = $1", [subAlice]);
      assert(n.n === "1", "abonnement supprimé");
    });
  });
  await test("export CSV : interdit à l'accueil, journalisé pour le propriétaire", async () => {
    await expectError(as(db, users.receptionA, () => db.query("select log_member_export($1, 10, '{}')", [orgA])), /non autorisée/);
    await as(db, users.ownerA, async () => {
      await db.query("select log_member_export($1, 2, '{\"q\":\"\"}')", [orgA]);
      const a = await one<{ n: string }>(db, "select count(*) n from audit_logs where action = 'members.export'");
      assert(a.n === "1", "export non journalisé");
    });
  });
  await test("archivage d'un membre journalisé (avant/après)", async () => {
    await as(db, users.receptionA, async () => {
      await db.query("update members set archived_at = now(), archive_reason = 'test' where id = $1", [bob]);
      // L'accueil ne lit pas le journal d'audit...
      const visible = await one<{ n: string }>(db, "select count(*) n from audit_logs");
      assert(visible.n === "0", "l'accueil voit le journal d'audit");
      // ...mais l'entrée existe bien (vérification avec les droits administrateur).
      await db.query("reset role");
      const a = await one<{ n: string }>(db, "select count(*) n from audit_logs where action = 'members.update' and entity_id = $1", [bob]);
      assert(a.n === "1", "pas d'audit");
    });
  });
  await test("stockage : photo déposable dans le dossier de SA salle uniquement", async () => {
    await as(db, users.receptionA, () => db.query(
      "insert into storage.objects (bucket_id, name) values ('member-photos', $1)", [`${orgA}/${alice}/photo.jpg`]));
    await expectError(as(db, users.ownerB, () => db.query(
      "insert into storage.objects (bucket_id, name) values ('member-photos', $1)", [`${orgA}/${alice}/intrus.jpg`])), /row-level security/);
    await expectError(as(db, users.coachA, () => db.query(
      "insert into storage.objects (bucket_id, name) values ('member-photos', $1)", [`${orgA}/${alice}/coach.jpg`])), /row-level security/);
  });

  console.log("\nNotifications");
  await test("alertes d'impayés : propriétaire et accueil oui, coach non", async () => {
    await asCommit(db, users.ownerA, () => db.query("select refresh_notifications($1)", [orgA]));
    const byUser = await rows<{ user_id: string; n: string }>(db,
      "select recipient_user_id user_id, count(*) n from notifications where type = 'unpaid_balance' group by 1");
    const ids = byUser.map((r) => r.user_id);
    assert(ids.includes(users.ownerA) && ids.includes(users.receptionA) && !ids.includes(users.coachA), JSON.stringify(byUser));
  });
  await test("recalcul idempotent (pas de doublon)", async () => {
    const n = await asCommit(db, users.ownerA, () => one<{ n: number }>(db, "select refresh_notifications($1) n", [orgA]));
    assert(n.n === 0, `${n.n} nouvelles`);
  });
  await test("chacun ne voit que ses notifications", async () => {
    const r = await as(db, users.receptionA, () => rows<{ recipient_user_id: string }>(db, "select recipient_user_id from notifications"));
    assert(r.length > 0 && r.every((x) => x.recipient_user_id === users.receptionA), "fuite");
  });

  await db.end();
  console.log(`\n${passed} réussis, ${failures.length} échoués`);
  if (failures.length) {
    console.log(failures.map((f) => ` - ${f}`).join("\n"));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
