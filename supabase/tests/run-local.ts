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
  await test("code d'entrée : 4 chiffres attribués à l'inscription, uniques dans la salle", async () => {
    await as(db, users.receptionA, async () => {
      for (let i = 0; i < 40; i++) {
        await db.query("insert into members (organization_id, first_name, last_name) values ($1, 'Lot', $2)", [orgA, `N${i}`]);
      }
      const r = await one<{ total: string; distinct_pins: string; bad: string }>(db,
        "select count(*) total, count(distinct checkin_pin) distinct_pins, count(*) filter (where checkin_pin !~ '^[0-9]{4}$' or checkin_pin is null) bad from members where organization_id = $1",
        [orgA]);
      assert(r.bad === "0" && r.total === r.distinct_pins, JSON.stringify(r));
    });
  });
  await test("code d'entrée : un doublon dans la même salle est refusé par la base", async () => {
    await expectError(as(db, users.ownerA, async () => {
      const pin = await one<{ checkin_pin: string }>(db, "select checkin_pin from members where id = $1", [alice]);
      await db.query("update members set checkin_pin = $1 where id = $2", [pin.checkin_pin, bob]);
    }), /duplicate key|unique/);
  });
  await test("code d'entrée : régénération (ancien code invalide, action journalisée)", async () => {
    await as(db, users.receptionA, async () => {
      const before = await one<{ checkin_pin: string }>(db, "select checkin_pin from members where id = $1", [alice]);
      const after = await one<{ p: string }>(db, "select regenerate_checkin_pin($1,$2) p", [orgA, alice]);
      assert(/^[0-9]{4}$/.test(after.p) && after.p !== before.checkin_pin, `${before.checkin_pin} -> ${after.p}`);
      const stored = await one<{ checkin_pin: string }>(db, "select checkin_pin from members where id = $1", [alice]);
      assert(stored.checkin_pin === after.p, "code non enregistré");
      const old = await one<{ n: string }>(db, "select count(*) n from members where organization_id = $1 and checkin_pin = $2", [orgA, before.checkin_pin]);
      assert(old.n === "0", "ancien code toujours attribué");
      // Le journal d'audit est masqué à l'accueil par la RLS : lecture en administrateur.
      await db.query("reset role");
      const a = await one<{ n: string }>(db, "select count(*) n from audit_logs where action = 'member.checkin_pin_regenerated' and entity_id = $1", [alice]);
      assert(a.n === "1", "pas d'audit");
    });
  });
  await test("code d'entrée : impossible de régénérer celui d'un membre d'une autre salle", async () => {
    await expectError(as(db, users.ownerB, () => db.query("select regenerate_checkin_pin($1,$2)", [orgA, alice])), /non autorisée/);
    await expectError(as(db, users.coachA, () => db.query("select regenerate_checkin_pin($1,$2)", [orgA, alice])), /non autorisée/);
  });
  await test("code d'entrée : l'entrée par code est enregistrée avec la méthode « pin »", async () => {
    await as(db, users.ownerA, async () => {
      await db.query("update organization_settings set checkin_debounce_minutes = 0 where organization_id = $1", [orgA]);
      const r = await one<{ r: { result: string; attendance_id: string } }>(db, "select check_in($1,$2,'pin') r", [orgA, alice]);
      assert(r.r.result === "granted", JSON.stringify(r.r));
      const m = await one<{ method: string }>(db, "select method from attendance where id = $1", [r.r.attendance_id]);
      assert(m.method === "pin", m.method);
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
  await test("modifier la salle fonctionne et est journalisé", async () => {
    await as(db, null, async () => {
      await db.query("update organizations set phone = '+216 70 000 000' where id = $1", [orgA]);
      const a = await one<{ n: string }>(db,
        "select count(*) n from audit_logs where action = 'organizations.update' and organization_id = $1", [orgA]);
      assert(a.n === "1", "pas d'audit");
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

  console.log("\nSynchronisation : postes");
  type OpResult = {
    status: string; replayed: boolean; error_message: string | null;
    result: Record<string, string> | null; conflicts: Array<Record<string, unknown>> | null;
  };
  const deviceA = randomUUID();
  const deviceB = randomUUID();
  const op = async (user: string, device: string, kind: string, args: unknown, occurredAt?: Date, opId = randomUUID()) =>
    (await asCommit(db, user, () => one<{ r: OpResult }>(db,
      "select sync_apply_op($1,$2,$3,$4,$5,$6) r", [orgA, device, opId, kind, args, occurredAt ?? null]))).r;
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

  await test("enregistrement idempotent, une série permanente par poste", async () => {
    const reg = (user: string, device: string) => asCommit(db, user, () => one<{ r: { series: string } }>(db,
      "select sync_register_device($1,$2,'Accueil') r", [orgA, device]));
    assert((await reg(users.receptionA, deviceA)).r.series === "A", "série du premier poste");
    assert((await reg(users.receptionA, deviceA)).r.series === "A", "série modifiée au 2e appel");
    assert((await reg(users.ownerA, deviceB)).r.series === "B", "série du second poste");
    assert((await reg(users.coachA, randomUUID())).r.series === "C", "un coach enregistre aussi son poste");
  });
  await test("un compte d'une autre salle ne peut ni enregistrer un poste ni lire le journal", async () => {
    await expectError(as(db, users.ownerB, () => db.query("select sync_register_device($1,$2)", [orgA, randomUUID()])), /non autorisée/);
    await expectError(as(db, users.ownerB, () => db.query("select sync_changes($1, 0)", [orgA])), /non autorisée/);
  });
  await test("un poste inconnu ne peut rien rejouer", async () => {
    await expectError(op(users.receptionA, randomUUID(), "check_in", {}), /non enregistré/);
  });
  await test("le rôle anonyme ne peut pas appeler les fonctions de synchronisation", async () => {
    await db.query("begin");
    await db.query("set local role anon");
    try {
      await expectError(db.query("select sync_changes($1, 0)", [orgA]), /permission denied/);
    } finally {
      await db.query("rollback");
    }
  });

  console.log("\nSynchronisation : journal des changements");
  const head = async (user = users.ownerA) => (await as(db, user, () => one<{ r: { head: number } }>(db,
    "select sync_changes($1, null) r", [orgA]))).r.head;
  const since = async (cursor: number) => (await as(db, users.ownerA, () => one<{
    r: { changes: Array<{ table: string; id: string; op: string; seq: number }>; next_since: number; has_more: boolean };
  }>(db, "select sync_changes($1, $2) r", [orgA, cursor]))).r;

  let program = "";
  await test("création, modification et suppression sont journalisées, dans l'ordre", async () => {
    const start = await head();
    program = (await asCommit(db, users.ownerA, () => one<{ id: string }>(db,
      "insert into workout_programs (organization_id, name) values ($1,'Journal') returning id", [orgA]))).id;
    await asCommit(db, users.ownerA, () => db.query("update workout_programs set name = 'Journal 2' where id = $1", [program]));
    await asCommit(db, users.ownerA, () => db.query("delete from workout_programs where id = $1", [program]));
    const c = (await since(start)).changes.filter((x) => x.table === "workout_programs" && x.id === program);
    assert(c.map((x) => x.op).join("") === "IUD", JSON.stringify(c));
    assert(c[0]!.seq < c[1]!.seq && c[1]!.seq < c[2]!.seq, "ordre");
  });
  await test("le journal ne contient rien d'une transaction annulée", async () => {
    const start = await head();
    await as(db, users.ownerA, () => db.query("insert into workout_programs (organization_id, name) values ($1,'Annulé')", [orgA]));
    assert((await since(start)).changes.length === 0, "entrée fantôme");
  });
  await test("les salles ont chacune leur journal", async () => {
    const start = await head();
    await asCommit(db, users.ownerB, () => db.query("insert into workout_programs (organization_id, name) values ($1,'Salle B')", [orgB]));
    assert((await since(start)).changes.length === 0, "changement d'une autre salle visible");
  });
  await test("pagination : le curseur reprend là où il s'est arrêté", async () => {
    const start = await head();
    for (const n of ["P1", "P2", "P3"]) {
      await asCommit(db, users.ownerA, () => db.query("insert into workout_programs (organization_id, name) values ($1,$2)", [orgA, n]));
    }
    const page = await as(db, users.ownerA, () => one<{ r: { changes: unknown[]; next_since: number; has_more: boolean } }>(db,
      "select sync_changes($1,$2,1) r", [orgA, start]));
    assert(page.r.changes.length === 1 && page.r.has_more, JSON.stringify(page.r));
    assert((await since(page.r.next_since)).changes.length >= 2, "reprise incomplète");
  });
  await test("journal purgé : le poste en retard doit tout relire", async () => {
    await db.query("begin");
    await db.query("select private.sync_prune(interval '0 seconds')");
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [users.ownerA]);
    const behind = await one<{ r: { resync_required: boolean } }>(db, "select sync_changes($1, 0) r", [orgA]);
    const current = await one<{ r: { head: number } }>(db, "select sync_changes($1, null) r", [orgA]);
    const upToDate = await one<{ r: { resync_required: boolean } }>(db, "select sync_changes($1, $2) r", [orgA, current.r.head]);
    await db.query("rollback");
    assert(behind.r.resync_required, "poste en retard non détecté");
    assert(!upToDate.r.resync_required, "poste à jour renvoyé vers une relecture complète");
  });
  await test("la version de ligne est attribuée par le serveur et augmente à chaque modification", async () => {
    const before = await one<{ v: string }>(db, "select row_version v from members where id = $1", [alice]);
    await asCommit(db, users.ownerA, () => db.query("update members set first_name = 'Alice' where id = $1", [alice]));
    const after = await one<{ v: string }>(db, "select row_version v from members where id = $1", [alice]);
    assert(Number(after.v) === Number(before.v) + 1, `${before.v} -> ${after.v}`);
  });

  console.log("\nSynchronisation : rejeu sans doublon");
  await test("le même envoi deux fois (réseau coupé) ne crée qu'un seul passage", async () => {
    const opId = randomUUID();
    const at = hoursAgo(2);
    const first = await op(users.receptionA, deviceA, "check_in", { member: alice, method: "search" }, at, opId);
    const second = await op(users.receptionA, deviceA, "check_in", { member: alice, method: "search" }, at, opId);
    assert(first.status === "applied" && !first.replayed, JSON.stringify(first));
    assert(second.replayed && second.result?.attendance_id === first.result?.attendance_id, JSON.stringify(second));
    const n = await one<{ n: string }>(db, "select count(*) n from attendance where id = $1", [first.result!.attendance_id]);
    assert(n.n === "1", `${n.n} passages`);
  });
  await test("un identifiant d'opération ne peut pas être réutilisé par un autre compte", async () => {
    const opId = randomUUID();
    await op(users.receptionA, deviceA, "check_in", { member: alice, method: "search" }, hoursAgo(5), opId);
    await expectError(op(users.ownerA, deviceB, "check_in", { member: alice, method: "search" }, hoursAgo(5), opId), /autre compte/);
  });
  await test("le passage garde son heure réelle et l'identifiant créé sur le poste", async () => {
    const at = hoursAgo(24);
    const rowId = randomUUID();
    const r = await op(users.receptionA, deviceA, "check_in", { member: alice, method: "qr", row_id: rowId }, at);
    assert(r.result?.attendance_id === rowId, JSON.stringify(r));
    const a = await one<{ t: Date }>(db, "select checked_in_at t from attendance where id = $1", [rowId]);
    assert(Math.abs(a.t.getTime() - at.getTime()) < 1000, `${a.t.toISOString()} vs ${at.toISOString()}`);
  });
  await test("deux postes scannent le même membre : second passage reconnu comme doublon", async () => {
    const at = hoursAgo(30);
    const r1 = await op(users.receptionA, deviceA, "check_in", { member: alice, method: "qr" }, at);
    const r2 = await op(users.ownerA, deviceB, "check_in", { member: alice, method: "qr" }, new Date(at.getTime() + 60_000));
    assert(r2.result?.result === "duplicate" && r2.result?.attendance_id === r1.result?.attendance_id, JSON.stringify(r2));
  });
  await test("sortie hors ligne enregistrée à son heure réelle", async () => {
    const rowId = randomUUID();
    await op(users.receptionA, deviceA, "check_in", { member: alice, method: "qr", row_id: rowId }, hoursAgo(40));
    const out = hoursAgo(39);
    const r = await op(users.receptionA, deviceA, "check_out", { attendance: rowId }, out);
    assert(r.status === "applied", JSON.stringify(r));
    const a = await one<{ t: Date }>(db, "select checked_out_at t from attendance where id = $1", [rowId]);
    assert(Math.abs(a.t.getTime() - out.getTime()) < 1000, a.t.toISOString());
  });
  await test("abonnement expiré entre-temps : le passage réel est conservé et tracé", async () => {
    const dali = (await asCommit(db, users.receptionA, () => one<{ id: string }>(db,
      "insert into members (organization_id, first_name, last_name) values ($1,'Dali','SansAbo') returning id", [orgA]))).id;
    const r = await op(users.receptionA, deviceA, "check_in", { member: dali, method: "search" }, hoursAgo(1));
    assert(r.status === "applied" && r.result?.result === "granted", JSON.stringify(r));
    const a = await one<{ override_reason: string }>(db, "select override_reason from attendance where id = $1", [r.result!.attendance_id]);
    assert(a.override_reason.startsWith("Hors ligne :"), a.override_reason);
    const audit = await one<{ n: string }>(db, "select count(*) n from audit_logs where action = 'attendance.override' and entity_id = $1", [r.result!.attendance_id]);
    assert(audit.n === "1", "écart non tracé");
  });
  await test("hors rejeu, la règle web reste inchangée : même membre refusé sans motif", async () => {
    const dali = await one<{ id: string }>(db, "select id from members where first_name = 'Dali'");
    await db.query("update attendance set status = 'voided' where member_id = $1", [dali.id]);
    const r = await as(db, users.receptionA, () => one<{ r: { result: string } }>(db, "select check_in($1,$2,'search') r", [orgA, dali.id]));
    assert(r.r.result === "denied", JSON.stringify(r.r));
  });

  console.log("\nSynchronisation : numéros par poste");
  const newMember = (code: string, device = deviceA, user = users.receptionA) => op(user, device, "row.insert", {
    table: "members", id: randomUUID(), values: { first_name: "Code", last_name: code, member_code: code },
  });
  const codeOf = async (lastName: string) => (await one<{ c: string }>(db, "select member_code c from members where last_name = $1", [lastName])).c;
  await test("code membre créé hors ligne conservé s'il est dans la série du poste", async () => {
    const r = await newMember("M-A-000001");
    assert(r.status === "applied", JSON.stringify(r));
    assert((await codeOf("M-A-000001")) === "M-A-000001", "code remplacé");
  });
  await test("code d'une autre série refusé : le serveur attribue le sien", async () => {
    await newMember("M-B-000001");
    assert(/^M-\d{6}$/.test(await codeOf("M-B-000001")), await codeOf("M-B-000001"));
  });
  await test("hors rejeu, un code fourni directement est ignoré", async () => {
    await asCommit(db, users.receptionA, () => db.query(
      "insert into members (organization_id, first_name, last_name, member_code) values ($1,'Direct','M-A-000002','M-A-000002')", [orgA]));
    assert(/^M-\d{6}$/.test(await codeOf("M-A-000002")), await codeOf("M-A-000002"));
  });
  await test("même code envoyé deux fois : refus enregistré, pas de doublon", async () => {
    const r = await op(users.receptionA, deviceA, "row.insert", {
      table: "members", id: randomUUID(), values: { first_name: "Autre", last_name: "Personne", member_code: "M-A-000001" },
    });
    assert(r.status === "rejected", JSON.stringify(r));
    const n = await one<{ n: string }>(db, "select count(*) n from members where member_code = 'M-A-000001'");
    assert(n.n === "1", `${n.n} membres`);
  });
  await test("même identifiant de ligne envoyé deux fois : une seule fiche", async () => {
    const id = randomUUID();
    const a = await op(users.receptionA, deviceA, "row.insert", { table: "members", id, values: { first_name: "Une", last_name: "Fiche" } });
    const b = await op(users.receptionA, deviceA, "row.insert", { table: "members", id, values: { first_name: "Une", last_name: "Fiche" } });
    assert(a.result?.inserted && !b.result?.inserted && b.status === "applied", JSON.stringify([a, b]));
    const n = await one<{ n: string }>(db, "select count(*) n from members where id = $1", [id]);
    assert(n.n === "1", `${n.n} fiches`);
  });

  console.log("\nSynchronisation : paiements");
  const pay = (args: Record<string, unknown>, occurredAt?: Date, user = users.receptionA, device = deviceA) =>
    op(user, device, "record_payment", { member: alice, method: cash, request_id: randomUUID(), ...args }, occurredAt);
  await test("paiement hors ligne : numéro du poste et heure réelle, même antidaté par l'accueil", async () => {
    const at = hoursAgo(72);
    const r = await pay({ amount: 5, subscription: subAlice, receipt_number: "R-A-2026-000001" }, at);
    assert(r.status === "applied" && r.result?.receipt_number === "R-A-2026-000001", JSON.stringify(r));
    const p = await one<{ t: Date }>(db, "select paid_at t from payments where id = $1", [r.result!.payment_id]);
    assert(Math.abs(p.t.getTime() - at.getTime()) < 1000, p.t.toISOString());
  });
  await test("reçu d'une autre série refusé : le serveur attribue le sien", async () => {
    const r = await pay({ amount: 1, subscription: subAlice, receipt_number: "R-B-2026-000009" });
    assert(/^R-\d{4}-\d{6}$/.test(r.result!.receipt_number!), JSON.stringify(r));
  });
  await test("même paiement rejoué avec un nouvel op_id : un seul encaissement", async () => {
    const request = randomUUID();
    const a = await pay({ amount: 1, subscription: subAlice, request_id: request });
    const b = await pay({ amount: 1, subscription: subAlice, request_id: request });
    assert(a.result?.payment_id === b.result?.payment_id, JSON.stringify([a, b]));
  });
  await test("trop-perçu au rejeu : refus enregistré, solde intact", async () => {
    const before = await one<{ b: string }>(db, "select balance b from subscription_overview where id = $1", [subAlice]);
    const r = await pay({ amount: 9999, subscription: subAlice });
    assert(r.status === "rejected" && /dépasse le reste à payer/.test(r.error_message!), JSON.stringify(r));
    const after = await one<{ b: string }>(db, "select balance b from subscription_overview where id = $1", [subAlice]);
    assert(before.b === after.b, `${before.b} -> ${after.b}`);
    const row = await one<{ status: string }>(db, "select status from sync_ops where error_message like '%dépasse%' order by created_at desc limit 1");
    assert(row.status === "rejected", "refus non conservé pour revue");
  });
  await test("paiement trop ancien ou daté dans le futur : refus enregistré", async () => {
    const old = await pay({ amount: 1, subscription: subAlice }, hoursAgo(24 * 40));
    assert(old.status === "rejected" && /trop ancienne/.test(old.error_message!), JSON.stringify(old));
    const future = await pay({ amount: 1, subscription: subAlice }, hoursAgo(-2));
    assert(future.status === "rejected" && /horloge/.test(future.error_message!), JSON.stringify(future));
  });
  await test("abonnement et paiement créés hors ligne s'enchaînent via leur request_id", async () => {
    const carl = (await asCommit(db, users.receptionA, () => one<{ id: string }>(db,
      "insert into members (organization_id, first_name, last_name) values ($1,'Carl','Enchaine') returning id", [orgA]))).id;
    const subRequest = randomUUID();
    const s = await op(users.receptionA, deviceA, "create_subscription", { member: carl, plan: monthly, request_id: subRequest });
    assert(s.status === "applied", JSON.stringify(s));
    const payRequest = randomUUID();
    const p = await pay({ member: carl, amount: 10, subscription_request: subRequest, request_id: payRequest });
    assert(p.status === "applied", JSON.stringify(p));
    const refund = await op(users.ownerA, deviceB, "refund_payment",
      { payment_request: payRequest, type: "refund", amount: 2, reason: "Erreur de saisie", request_id: randomUUID() });
    assert(refund.status === "applied", JSON.stringify(refund));
    const o = await one<{ amount_paid: string }>(db, "select amount_paid from subscription_overview where id = $1", [s.result!.subscription_id]);
    assert(o.amount_paid === "8.000", o.amount_paid);
  });
  await test("deux postes vendent le même abonnement : le second est refusé, pas de doublon", async () => {
    const eve = (await asCommit(db, users.receptionA, () => one<{ id: string }>(db,
      "insert into members (organization_id, first_name, last_name) values ($1,'Eve','Double') returning id", [orgA]))).id;
    const today = (await one<{ d: string }>(db, "select current_date::text d")).d;
    const a = await op(users.receptionA, deviceA, "create_subscription", { member: eve, plan: monthly, request_id: randomUUID(), start: today });
    const b = await op(users.ownerA, deviceB, "create_subscription", { member: eve, plan: monthly, request_id: randomUUID(), start: today });
    assert(a.status === "applied" && b.status === "rejected", JSON.stringify([a, b]));
    assert(/déjà une adhésion/.test(b.error_message!), b.error_message!);
  });
  await test("l'accueil ne peut pas rembourser, même par rejeu", async () => {
    const r = await op(users.receptionA, deviceA, "refund_payment",
      { payment: pay1, type: "refund", amount: 1, reason: "Essai", request_id: randomUUID() });
    assert(r.status === "rejected" && /non autorisée/.test(r.error_message!), JSON.stringify(r));
  });

  console.log("\nSynchronisation : conflits, jamais d'écrasement");
  const memberRow = () => one<{ phone: string | null; email: string | null; first_name: string }>(db,
    "select phone, email, first_name from members where id = $1", [bob]);
  await test("champs différents modifiés de chaque côté : les deux modifications sont gardées", async () => {
    const base = await memberRow();
    await asCommit(db, users.ownerA, () => db.query("update members set first_name = 'Web' where id = $1", [bob]));
    const r = await op(users.receptionA, deviceA, "row.update", {
      table: "members", id: bob, base: { email: base.email }, changes: { email: "bob@hors-ligne.tn" },
    });
    assert(r.status === "applied", JSON.stringify(r));
    const m = await memberRow();
    assert(m.first_name === "Web" && m.email === "bob@hors-ligne.tn", JSON.stringify(m));
  });
  await test("même champ modifié des deux côtés : la valeur du serveur reste, le conflit part en revue", async () => {
    const base = await memberRow();
    await asCommit(db, users.ownerA, () => db.query("update members set phone = '11 111 111' where id = $1", [bob]));
    const r = await op(users.receptionA, deviceA, "row.update", {
      table: "members", id: bob, base: { phone: base.phone, first_name: base.first_name }, changes: { phone: "22 222 222", first_name: "HorsLigne" },
    });
    assert(r.status === "conflict", JSON.stringify(r));
    assert(r.conflicts?.length === 1 && r.conflicts[0]!.field === "phone" && r.conflicts[0]!.server === "11 111 111", JSON.stringify(r.conflicts));
    const m = await memberRow();
    assert(m.phone === "11 111 111" && m.first_name === "HorsLigne", JSON.stringify(m));
  });
  await test("une ancienne modification hors ligne n'écrase jamais une plus récente, quelle que soit l'horloge", async () => {
    const r = await op(users.receptionA, deviceA, "row.update", {
      table: "members", id: bob, base: { phone: "ancienne valeur" }, changes: { phone: "33 333 333" },
    }, hoursAgo(1));
    assert(r.status === "conflict", JSON.stringify(r));
    assert((await memberRow()).phone === "11 111 111", "valeur écrasée");
  });
  await test("modification déjà faite ailleurs à l'identique : aucun conflit", async () => {
    const r = await op(users.receptionA, deviceA, "row.update", {
      table: "members", id: bob, base: { phone: "ancienne valeur" }, changes: { phone: "11 111 111" },
    });
    assert(r.status === "applied", JSON.stringify(r));
  });
  await test("suppression d'une ligne modifiée entre-temps : conservée, conflit signalé", async () => {
    const id = (await asCommit(db, users.ownerA, () => one<{ id: string }>(db,
      "insert into workout_programs (organization_id, name) values ($1,'A garder') returning id", [orgA]))).id;
    await asCommit(db, users.ownerA, () => db.query("update workout_programs set name = 'Modifié' where id = $1", [id]));
    const r = await op(users.ownerA, deviceB, "row.delete", { table: "workout_programs", id, base_version: 1 });
    assert(r.status === "conflict", JSON.stringify(r));
    const ok = await op(users.ownerA, deviceB, "row.delete", { table: "workout_programs", id, base_version: 2 });
    assert(ok.status === "applied" && ok.result?.deleted, JSON.stringify(ok));
  });
  await test("résolution d'un conflit : réservée à son auteur ou au propriétaire", async () => {
    const opId = randomUUID();
    await op(users.receptionA, deviceA, "row.update", {
      table: "members", id: bob, base: { phone: "x" }, changes: { phone: "y" },
    }, undefined, opId);
    await expectError(as(db, users.coachA, () => db.query("select sync_resolve_op($1,$2)", [orgA, opId])), /non autorisée/);
    await asCommit(db, users.ownerA, () => db.query("select sync_resolve_op($1,$2)", [orgA, opId]));
    const r = await one<{ resolved_at: Date | null }>(db, "select resolved_at from sync_ops where op_id = $1", [opId]);
    assert(r.resolved_at !== null, "non résolu");
  });

  console.log("\nSynchronisation : rôles et permissions conservés");
  await test("un coach ne peut pas modifier une fiche par rejeu", async () => {
    const r = await op(users.coachA, deviceA, "row.update", { table: "members", id: alice, base: { first_name: "Alice" }, changes: { first_name: "x" } });
    assert(r.status === "rejected", JSON.stringify(r));
  });
  await test("tables et champs sensibles fermés au rejeu", async () => {
    const staff = await op(users.ownerA, deviceB, "row.update", { table: "staff", id: randomUUID(), base: {}, changes: { role: "owner" } });
    assert(staff.status === "rejected" && /non autorisée/.test(staff.error_message!), JSON.stringify(staff));
    const pays = await op(users.ownerA, deviceB, "row.update", { table: "payments", id: pay1, base: { amount: 30 }, changes: { amount: 1 } });
    assert(pays.status === "rejected", JSON.stringify(pays));
    const code = await op(users.ownerA, deviceB, "row.update", { table: "members", id: alice, base: { member_code: "M-000001" }, changes: { member_code: "Z" } });
    assert(code.status === "rejected", JSON.stringify(code));
    const org = await op(users.ownerA, deviceB, "row.insert", { table: "coaches", id: randomUUID(), values: { full_name: "X", organization_id: orgB } });
    assert(org.status === "rejected", JSON.stringify(org));
  });
  await test("un nom de champ malveillant ne s'exécute pas", async () => {
    const r = await op(users.ownerA, deviceB, "row.update", {
      table: "members", id: alice, base: { "notes = 'x'; drop table members; --": null }, changes: { "notes = 'x'; drop table members; --": 1 },
    });
    assert(r.status === "rejected", JSON.stringify(r));
    assert((await one<{ n: string }>(db, "select count(*) n from members")).n !== "0", "table touchée");
  });
  await test("un nom de table malveillant est refusé", async () => {
    const r = await op(users.ownerA, deviceB, "row.delete", { table: "members; drop table members", id: alice, base_version: 99 });
    assert(r.status === "rejected", JSON.stringify(r));
  });
  await test("une opération d'une autre salle reste invisible", async () => {
    const n = await as(db, users.ownerB, () => one<{ n: string }>(db, "select count(*) n from sync_ops"));
    assert(n.n === "0", `${n.n} opérations visibles`);
  });
  await test("le coach ne voit pas les opérations des autres, le propriétaire si", async () => {
    const coach = await as(db, users.coachA, () => one<{ n: string }>(db, "select count(*) n from sync_ops where user_id <> $1", [users.coachA]));
    assert(coach.n === "0", `${coach.n} opérations visibles`);
    const owner = await as(db, users.ownerA, () => one<{ n: string }>(db, "select count(*) n from sync_ops where user_id <> $1", [users.ownerA]));
    assert(Number(owner.n) > 0, "le propriétaire ne voit rien");
  });
  await test("employé désactivé : son opération est refusée à la synchronisation et enregistrée", async () => {
    await db.query("update staff set is_active = false where user_id = $1", [users.coachA]);
    const opId = randomUUID();
    const r = await op(users.coachA, deviceA, "check_in", { member: alice, method: "qr" }, hoursAgo(1), opId);
    await db.query("update staff set is_active = true where user_id = $1", [users.coachA]);
    assert(r.status === "rejected" && /désactivé/.test(r.error_message!), JSON.stringify(r));
  });
  await test("poste révoqué : plus aucune opération acceptée, ni nouvel enregistrement", async () => {
    await expectError(as(db, users.receptionA, () => db.query("select sync_revoke_device($1,$2)", [orgA, deviceB])), /non autorisée/);
    await asCommit(db, users.ownerA, () => db.query("select sync_revoke_device($1,$2)", [orgA, deviceB]));
    await expectError(op(users.ownerA, deviceB, "check_in", { member: alice, method: "qr" }), /révoqué/);
    await expectError(as(db, users.ownerA, () => db.query("select sync_register_device($1,$2)", [orgA, deviceB])), /révoqué/);
    const a = await one<{ n: string }>(db, "select count(*) n from audit_logs where action = 'sync_devices.update'");
    assert(a.n === "1", "révocation non tracée");
  });

  console.log("\nChatbot");
  let convA = "";
  await test("connexion d'un compte : propriétaire seulement, jeton illisible par l'API", async () => {
    await expectError(as(db, users.receptionA, () => db.query(
      "select chatbot_connect_account($1,'whatsapp','123456789','Salle A','EAAtoken-de-test-assez-long')", [orgA])), /non autorisée/);
    await asCommit(db, users.ownerA, async () => {
      await db.query("select chatbot_connect_account($1,'whatsapp','123456789','Salle A','EAAtoken-de-test-assez-long')", [orgA]);
      const acc = await rows(db, "select channel, external_id from chat_channel_accounts");
      assert(acc.length === 1, JSON.stringify(acc));
    });
    await expectError(as(db, users.ownerA, () => db.query("select * from private.chat_channel_secrets")), /permission denied/);
    await expectError(as(db, users.ownerA, () => db.query("select chatbot_account_token(id) from chat_channel_accounts")), /permission denied/);
    await expectError(as(db, users.ownerB, () => db.query(
      "select chatbot_connect_account($1,'whatsapp','123456789','Vol','EAAautre-salle-jeton-long')", [orgB])), /autre salle/);
  });
  await test("boîte de réception : propriétaire et accueil oui, coach et autre salle non", async () => {
    // Le webhook écrit en service_role : ici, en administrateur.
    convA = (await one<{ id: string }>(db,
      "insert into chat_conversations (organization_id, channel, external_user_id, contact_name) values ($1,'whatsapp','21622000111','Client WA') returning id", [orgA])).id;
    await db.query("insert into chat_messages (organization_id, conversation_id, sender, body) values ($1,$2,'contact','Bonjour, vos prix ?')", [orgA, convA]);
    for (const u of [users.ownerA, users.receptionA]) {
      const r = await as(db, u, () => rows(db, "select id from chat_messages"));
      assert(r.length === 1, `${u} : ${r.length}`);
    }
    for (const u of [users.coachA, users.ownerB]) {
      const r = await as(db, u, () => rows(db, "select id from chat_conversations"));
      assert(r.length === 0, "fuite vers " + u);
    }
  });
  await test("le personnel répond en son nom uniquement (pas de faux message client ou bot)", async () => {
    await as(db, users.receptionA, async () => {
      await db.query("insert into chat_messages (organization_id, conversation_id, sender, body, staff_user_id) values ($1,$2,'staff','On vous rappelle',$3)", [orgA, convA, users.receptionA]);
    });
    await expectError(as(db, users.receptionA, () => db.query(
      "insert into chat_messages (organization_id, conversation_id, sender, body) values ($1,$2,'bot','faux')", [orgA, convA])), /row-level security/);
    await expectError(as(db, users.receptionA, () => db.query(
      "insert into chat_messages (organization_id, conversation_id, sender, body, staff_user_id) values ($1,$2,'staff','x',$3)", [orgA, convA, users.ownerA])), /row-level security/);
  });
  await test("reprise de main : statut modifiable, identité du contact non", async () => {
    await as(db, users.receptionA, async () => {
      await db.query("update chat_conversations set status = 'human', needs_human = false where id = $1", [convA]);
    });
    await expectError(as(db, users.receptionA, () => db.query(
      "update chat_conversations set external_user_id = '21699999999' where id = $1", [convA])), /non modifiable/);
  });
  await test("réglages : l'accueil lit, seul le propriétaire modifie", async () => {
    await as(db, users.ownerA, () => db.query("insert into chatbot_settings (organization_id, enabled, knowledge) values ($1, true, 'Ouvert 6h-22h')", [orgA]));
    await expectError(as(db, users.receptionA, () => db.query(
      "insert into chatbot_settings (organization_id, enabled) values ($1, true)", [orgA])), /row-level security/);
  });
  await test("fonctions du bot réservées au serveur (service_role)", async () => {
    for (const sql of ["select chatbot_book_session($1, gen_random_uuid(), gen_random_uuid())", "select chatbot_notify_staff($1, gen_random_uuid(), 't', 'b')"]) {
      await expectError(as(db, users.ownerA, () => db.query(sql, [orgA])), /permission denied/);
    }
  });
  await test("réservation par le bot : abonnement valide exigé, places et doublon contrôlés", async () => {
    const session = (await one<{ id: string }>(db,
      "insert into sessions (organization_id, kind, title, starts_at, ends_at, capacity) values ($1,'group_class','Boxe bot', now() + interval '1 day', now() + interval '1 day 1 hour', 1) returning id", [orgA])).id;
    await expectError(db.query("select chatbot_book_session($1,$2,$3)", [orgA, session, bob]), /non valide/);
    const id = await one<{ b: string }>(db, "select chatbot_book_session($1,$2,$3) b", [orgA, session, alice]);
    assert(id.b, "pas de réservation");
    await expectError(db.query("select chatbot_book_session($1,$2,$3)", [orgA, session, alice]), /Déjà inscrit/);
    await db.query("update members set membership_end_date = current_date + 30, membership_suspended = false where id = $1", [bob]);
    await expectError(db.query("select chatbot_book_session($1,$2,$3)", [orgA, session, bob]), /complète/);
  });
  await test("notification du personnel : accueil et propriétaire, pas le coach", async () => {
    const n = await one<{ n: number }>(db, "select chatbot_notify_staff($1,$2,'Client en attente','Demande un conseiller') n", [orgA, convA]);
    assert(Number(n.n) === 2, String(n.n));
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
