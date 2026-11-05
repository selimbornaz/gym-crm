/**
 * Tests du mode hors ligne, comparé à un vrai PostgreSQL.
 *
 *   TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/postgres npm run db:test:offline
 *
 * Les mêmes données sont lues en SQL sous RLS et par la couche locale : les vues
 * et les rapports doivent donner exactement les mêmes chiffres, pour chaque rôle.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { LocalQuery, parseSelect, relationOf } from "@/lib/offline/query";
import { runLocalRpc } from "@/lib/offline/rpc";
import { pullAll, type RemoteClient } from "@/lib/offline/sync";
import { computeEndDate } from "@/lib/offline/writes";
import { pushQueue, registerDevice, syncAll } from "@/lib/offline/push";
import { WRITABLE_TABLES, readColumns, renderColumns } from "./generate-columns";
import {
  applyBatch, closeStore, forgetUser, getMeta, pendingCount, rememberAccount, rowsOf, signSession, verifyAccount, verifySession,
} from "@/lib/offline/store";
import { createLocalClient } from "@/lib/offline/client";
import { VIEW_TABLES } from "@/lib/offline/schema";

const ADMIN_URL = process.env.TEST_DATABASE_URL ?? "postgresql://gym:gym@localhost:5432/postgres";
const TEST_DB = "gym_crm_offline";
const root = join(__dirname, "..");

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push(`${name}: ${(err as Error).message}`);
    console.log(`  ✗ ${name}\n      ${(err as Error).message.slice(0, 1200)}`);
  }
}
function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

/** Égalité stricte, indifférente à l'ordre des clés et à l'écriture des montants. */
function canon(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canon);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, canon(v)]));
  }
  return value;
}
function assertSame(actual: unknown, expected: unknown, what: string) {
  const a = JSON.stringify(canon(actual));
  const e = JSON.stringify(canon(expected));
  if (a !== e) {
    const at = [...a].findIndex((ch, i) => ch !== e[i]);
    throw new Error(`${what} diffère à la position ${at}\n  local : …${a.slice(Math.max(0, at - 120), at + 160)}\n  SQL   : …${e.slice(Math.max(0, at - 120), at + 160)}`);
  }
}
const byId = (rows: Array<Record<string, unknown>>) => [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));

let db: Client;

/** Lit sous l'identité d'un utilisateur, exactement comme PostgREST : RLS active. */
async function asUser<T>(user: string, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.query("begin");
  try {
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
    const r = await db.query(sql, params);
    await db.query("rollback");
    return r.rows as T[];
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}
async function writeAs(user: string, sql: string, params: unknown[] = []) {
  await db.query("begin");
  try {
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
    const r = await db.query(sql, params);
    await db.query("commit");
    return r.rows;
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}

/** Client minimal qui se comporte comme l'API : chaque lecture passe par la RLS. */
function remoteFor(user: string): RemoteClient {
  const builder = (table: string) => {
    const where: string[] = [];
    const params: unknown[] = [];
    let order = "";
    let page = "";
    const api = {
      eq(column: string, value: unknown) { params.push(value); where.push(`t.${column}::text = $${params.length}::text`); return api; },
      in(column: string, values: unknown[]) { params.push(values); where.push(`t.${column}::text = any($${params.length}::text[])`); return api; },
      order(column: string) { order = ` order by t.${column}`; return api; },
      range(from: number, to: number) { page = ` limit ${to - from + 1} offset ${from}`; return api; },
      then(resolve: (v: { data: unknown[] | null; error: { message: string } | null }) => unknown, reject?: (e: unknown) => unknown) {
        return asUser<{ r: unknown }>(user, `select to_json(t) r from public.${table} t ${where.length ? `where ${where.join(" and ")}` : ""}${order}${page}`, params)
          .then((rows) => resolve({ data: rows.map((x) => x.r), error: null }), (e) => resolve({ data: null, error: { message: (e as Error).message } }))
          .catch(reject);
      },
    };
    return api;
  };
  return {
    from: (table) => ({ select: () => builder(table) as never }),
    rpc: (name, args) => {
      const run = async () => {
        try {
          if (name === "sync_apply_op") {
            const rows = await writeAs(user, "select sync_apply_op($1,$2,$3,$4,$5,$6) r", [args.p_org, args.p_device, args.p_op_id, args.p_kind, args.p_args, args.p_occurred_at]);
            return { data: rows[0].r, error: null };
          }
          if (name === "sync_register_device") {
            const rows = await writeAs(user, "select sync_register_device($1,$2,$3) r", [args.p_org, args.p_device, args.p_name]);
            return { data: rows[0].r, error: null };
          }
          const rows = name === "sync_changes"
            ? await asUser<{ r: unknown }>(user, "select sync_changes($1,$2,$3) r", [args.p_org, args.p_since, args.p_limit ?? 500])
            : await asUser<{ r: unknown }>(user, "select my_permissions($1) r", [args.org]);
          return { data: rows[0]!.r, error: null };
        } catch (err) {
          return { data: null, error: { message: (err as Error).message } };
        }
      };
      return run();
    },
  };
}

const q = (user: string, table: string) => new LocalQuery(user, table);

async function main() {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${TEST_DB} with (force)`);
  await admin.query(`create database ${TEST_DB}`);
  await admin.end();
  const url = new URL(ADMIN_URL);
  url.pathname = `/${TEST_DB}`;
  db = new Client({ connectionString: url.toString() });
  await db.connect();
  await db.query("set timezone = 'UTC'");
  await db.query(readFileSync(join(root, "tests", "supabase_stub.sql"), "utf8"));
  for (const f of readdirSync(join(root, "migrations")).filter((x) => x.endsWith(".sql")).sort()) {
    await db.query(readFileSync(join(root, "migrations", f), "utf8"));
  }

  // CASTLE_TEST_KEEP_DIR : garde la copie pour le test de bout en bout de l'application.
  const keepDir = process.env.CASTLE_TEST_KEEP_DIR;
  const dir = keepDir ?? mkdtempSync(join(tmpdir(), "castle-offline-"));
  process.env.CASTLE_DATA_DIR = dir;
  process.env.CASTLE_DATA_KEY = randomBytes(32).toString("base64");

  // ------------------------------------------------------------------ données
  const owner = randomUUID();
  const reception = randomUUID();
  const coachUser = randomUUID();
  const ownerB = randomUUID();
  for (const [id, name] of [[owner, "Olfa Patronne"], [reception, "Rim Accueil"], [coachUser, "Karim Coach"], [ownerB, "Autre Salle"]] as const) {
    await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1,$2,$3)", [id, `${id}@test.tn`, { full_name: name }]);
  }
  const org = (await db.query("insert into organizations (name, slug, phone) values ('Castle','castle','+216 70') returning id")).rows[0].id as string;
  const orgB = (await db.query("insert into organizations (name, slug) values ('Autre','autre') returning id")).rows[0].id as string;
  await db.query("insert into staff (organization_id,user_id,role) values ($1,$2,'owner'),($1,$3,'receptionist'),($1,$4,'coach'),($5,$6,'owner')", [org, owner, reception, coachUser, orgB, ownerB]);
  const staffCoach = (await db.query("select id from staff where user_id=$1", [coachUser])).rows[0].id;
  const coach = (await db.query("insert into coaches (organization_id,staff_id,full_name) values ($1,$2,'Karim Coach') returning id", [org, staffCoach])).rows[0].id as string;
  const coach2 = (await db.query("insert into coaches (organization_id,full_name) values ($1,'Sonia Libre') returning id", [org])).rows[0].id as string;
  const monthly = (await db.query("insert into membership_plans (organization_id,name,kind,duration_value,duration_unit,price) values ($1,'Mensuel','membership',1,'month',80) returning id", [org])).rows[0].id as string;
  const yearly = (await db.query("insert into membership_plans (organization_id,name,kind,duration_value,duration_unit,price) values ($1,'Annuel','membership',1,'year',650.5) returning id", [org])).rows[0].id as string;
  const cash = (await db.query("select id from payment_methods where organization_id=$1 and code='cash'", [org])).rows[0].id as string;

  const newMember = async (first: string, last: string, phone: string | null, coachId: string | null = null, email: string | null = null) =>
    (await writeAs(reception, "insert into members (organization_id,first_name,last_name,phone,email,coach_id) values ($1,$2,$3,$4,$5,$6) returning id", [org, first, last, phone, email, coachId]))[0].id as string;
  const alice = await newMember("Alice", "Ben Salah", "+216 22 333 444", coach, "alice@exemple.tn");
  const bob = await newMember("Bob", "Trabelsi", "55 666 777", coach2);
  const carla = await newMember("Élodie", "Zouari", null);
  const dali = await newMember("Dali", "Ayari", "98 111 222");
  const emna = await newMember("Emna", "Archivée", "20 999 888");
  await writeAs(reception, "update members set archived_at = now(), archive_reason = 'Départ' where id = $1", [emna]);

  const newSub = async (member: string, plan: string, start: string | null, discount = 0) =>
    (await writeAs(reception, "select create_subscription($1,$2,$3,$4,$5::date,$6) id", [org, member, plan, randomUUID(), start, discount]))[0].id as string;
  const subAlice = await newSub(alice, monthly, null, 5);
  const subBob = await newSub(bob, yearly, null);
  const subDali = await newSub(dali, monthly, "2026-10-15");
  await writeAs(owner, "select suspend_subscription($1,$2,'Blessure')", [org, subDali]);
  const pay = async (member: string, sub: string, amount: number, at: string | null = null) =>
    (await writeAs(owner, "select * from record_payment($1,$2,$3,$4,$5,$6,$7::timestamptz)", [org, member, cash, amount, randomUUID(), sub, at]))[0].payment_id as string;
  const p1 = await pay(alice, subAlice, 30);
  await pay(alice, subAlice, 12.345);
  await pay(bob, subBob, 650.5, new Date(Date.now() - 40 * 86_400_000).toISOString());
  await writeAs(owner, "select refund_payment($1,$2,'refund',10.005,'Erreur de saisie',$3)", [org, p1, randomUUID()]);
  await writeAs(owner, "select * from record_payment($1,$2,$3,7.5,$4)", [org, carla, cash, randomUUID()]);
  await writeAs(reception, "select check_in($1,$2,'qr')", [org, alice]);
  await writeAs(reception, "select check_in($1,$2,'search')", [org, bob]);
  await writeAs(owner, "insert into expenses (organization_id,category,amount,spent_on,description) values ($1,'electricity',15.5,current_date,'STEG'),($1,'rent',300,current_date,'Loyer'),($1,'rent',12.25,current_date,'Annexe')", [org]);
  const session_ = (await writeAs(owner, "insert into sessions (organization_id,kind,title,coach_id,starts_at,ends_at,capacity) values ($1,'group_class','Yoga',$2,now()+interval '1 day',now()+interval '1 day 1 hour',10) returning id", [org, coach]))[0].id as string;
  await writeAs(reception, "select book_session($1,$2,$3)", [org, session_, alice]);
  await writeAs(owner, "insert into leads (organization_id,first_name,last_name,phone,coach_id) values ($1,'Lina','Prospect','99 000 111',$2)", [org, coach]);
  const equipment = (await writeAs(owner, "insert into equipment (organization_id,name) values ($1,'Tapis') returning id", [org]))[0].id as string;
  await writeAs(owner, "insert into equipment_maintenance (organization_id,equipment_id,performed_on,description) values ($1,$2,current_date,'Révision')", [org, equipment]);
  const program = (await writeAs(owner, "insert into workout_programs (organization_id,member_id,coach_id,name) values ($1,$2,$3,'Force') returning id", [org, alice, coach]))[0].id as string;
  const day = (await writeAs(owner, "insert into workout_days (organization_id,program_id,day_number,title) values ($1,$2,1,'Haut') returning id", [org, program]))[0].id as string;
  await writeAs(owner, "insert into workout_exercises (organization_id,day_id,name) values ($1,$2,'Squat')", [org, day]);
  await writeAs(owner, "select refresh_notifications($1)", [org]);

  console.log("Copie vers le poste");
  await test("première synchronisation complète pour chaque rôle", async () => {
    for (const user of [owner, reception, coachUser]) {
      const s = await pullAll(remoteFor(user), user, [org]);
      assert(s.fullCopies === 1 && s.upserted > 0, JSON.stringify(s));
    }
  });
  await test("le poste contient exactement ce que chaque rôle voit en ligne", async () => {
    for (const user of [owner, reception, coachUser]) {
      for (const table of ["members", "payments", "subscriptions", "attendance", "member_notes", "expenses", "notifications", "audit_logs", "leads", "staff"]) {
        const sql = await asUser<{ r: Record<string, unknown> }>(user, `select to_json(t) r from public.${table} t where t.organization_id = $1`, [org]);
        assertSame(byId(rowsOf(user, table)), byId(sql.map((x) => x.r)), `${table} (${user === owner ? "propriétaire" : user === reception ? "accueil" : "coach"})`);
      }
    }
  });
  await test("le coach n'a sur le poste ni paiements ni membres non assignés", () => {
    assert(rowsOf(coachUser, "payments").length === 0, "paiements présents");
    assert(rowsOf(coachUser, "members").every((m) => m.coach_id === coach), "membres d'autres coachs présents");
    assert(rowsOf(coachUser, "members").length === 1, `${rowsOf(coachUser, "members").length} membres`);
  });
  await test("rien d'une autre salle sur le poste", () => {
    for (const table of ["members", "payments", "organizations", "staff", "coaches"]) {
      assert(rowsOf(owner, table).every((r) => (r.organization_id ?? r.id) === org), table);
    }
  });

  console.log("\nVues : mêmes résultats qu'en SQL");
  for (const view of VIEW_TABLES) {
    await test(`${view} (propriétaire, accueil, coach)`, async () => {
      for (const user of [owner, reception, coachUser]) {
        const sql = await asUser<{ r: Record<string, unknown> }>(user, `select to_json(t) r from public.${view} t where t.organization_id = $1`, [org]);
        const local = (await q(user, view).select("*").eq("organization_id", org)).data as Array<Record<string, unknown>>;
        assertSame(byId(local), byId(sql.map((x) => x.r)), view);
      }
    });
  }

  console.log("\nRapports : mêmes chiffres qu'en SQL");
  const today = (await db.query("select (now() at time zone 'Africa/Tunis')::date::text d")).rows[0].d as string;
  const yearAgo = (await db.query("select ((now() at time zone 'Africa/Tunis')::date - 400)::text d")).rows[0].d as string;
  const sqlRpc = async (user: string, text: string, params: unknown[]) => (await asUser<{ r: unknown }>(user, text, params)).map((x) => x.r);
  await test("tableau de bord du propriétaire", async () => {
    const [sql] = await sqlRpc(owner, "select dashboard_stats($1) r", [org]);
    const local = runLocalRpc(owner, "dashboard_stats", { p_org: org });
    assert(!local.error, JSON.stringify(local.error));
    assertSame(local.data, sql, "dashboard_stats");
  });
  await test("tableau de bord de l'accueil : aucun chiffre financier", async () => {
    const [sql] = await sqlRpc(reception, "select dashboard_stats($1) r", [org]);
    const local = runLocalRpc(reception, "dashboard_stats", { p_org: org }).data as Record<string, unknown>;
    assert(!("revenue_today" in local), "chiffre financier présent");
    // Accueil : voit tous les membres et présences, donc les mêmes chiffres qu'en ligne.
    assertSame(local, sql, "dashboard_stats accueil");
  });
  await test("tableau de bord du coach : limité à ses membres, sans erreur", () => {
    const local = runLocalRpc(coachUser, "dashboard_stats", { p_org: org });
    if (local.error) assert(local.error.code === "42501", JSON.stringify(local.error));
    else assert((local.data as { members_total: number }).members_total === 1, JSON.stringify(local.data));
  });
  for (const g of ["day", "week", "month", "year"]) {
    await test(`encaissements par ${g}`, async () => {
      const sql = await sqlRpc(owner, "select to_json(t) r from revenue_report($1,$2::date,$3::date,$4) t", [org, yearAgo, today, g]);
      assertSame(runLocalRpc(owner, "revenue_report", { p_org: org, p_from: yearAgo, p_to: today, p_granularity: g }).data, sql, "revenue_report");
    });
  }
  await test("encaissements par formule", async () => {
    const sql = await sqlRpc(owner, "select to_json(t) r from revenue_by_plan($1,$2::date,$3::date) t", [org, yearAgo, today]);
    assertSame(runLocalRpc(owner, "revenue_by_plan", { p_org: org, p_from: yearAgo, p_to: today }).data, sql, "revenue_by_plan");
  });
  await test("compte de résultat", async () => {
    const [sql] = await sqlRpc(owner, "select profit_and_loss($1,$2::date,$3::date) r", [org, yearAgo, today]);
    assertSame(runLocalRpc(owner, "profit_and_loss", { p_org: org, p_from: yearAgo, p_to: today }).data, sql, "profit_and_loss");
  });
  await test("détection de doublons (téléphone, email, nom)", async () => {
    for (const a of [
      { p_first_name: "X", p_last_name: "Y", p_phone: "+216 22333444", p_email: null },
      { p_first_name: "X", p_last_name: "Y", p_phone: null, p_email: " ALICE@exemple.tn " },
      { p_first_name: " bob", p_last_name: "TRABELSI ", p_phone: null, p_email: null },
      { p_first_name: "Personne", p_last_name: "Inconnue", p_phone: "11", p_email: null },
    ]) {
      const sql = await sqlRpc(reception, "select to_json(t) r from find_member_duplicates($1,$2,$3,$4,$5) t", [org, a.p_first_name, a.p_last_name, a.p_phone, a.p_email]);
      assertSame(byId(runLocalRpc(reception, "find_member_duplicates", { p_org: org, ...a }).data as never), byId(sql as never), JSON.stringify(a));
    }
  });
  await test("rapports financiers refusés à l'accueil, comme en ligne", () => {
    for (const name of ["revenue_report", "revenue_by_plan", "profit_and_loss"]) {
      const r = runLocalRpc(reception, name, { p_org: org, p_from: yearAgo, p_to: today });
      assert(r.error?.code === "42501", `${name} : ${JSON.stringify(r)}`);
    }
  });
  await test("permissions identiques à celles du serveur", async () => {
    for (const user of [owner, reception, coachUser]) {
      const [sql] = await sqlRpc(user, "select my_permissions($1) r", [org]);
      assertSame(runLocalRpc(user, "my_permissions", { org }).data, sql, "my_permissions");
    }
  });

  console.log("\nRequêtes de l'application");
  await test("toutes les requêtes du code sont comprises par la couche locale", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d)) {
        const p = join(d, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e) && !p.includes("offline")) files.push(p);
      }
    };
    walk(join(root, "..", "src"));
    let checked = 0;
    const re = /\.from\("([a-z_]+)"\)\s*\.select\(\s*"([^"]+)"/g;
    for (const f of files) {
      for (const m of readFileSync(f, "utf8").matchAll(re)) {
        const check = (table: string, fields: ReturnType<typeof parseSelect>) => {
          for (const field of fields) {
            if (field.embed) {
              relationOf(table, field.embed.table);
              check(field.embed.table, field.embed.fields);
            }
          }
        };
        check(m[1]!, parseSelect(m[2]!));
        checked++;
      }
    }
    assert(checked >= 40, `${checked} requêtes seulement`);
  });
  await test("toutes les fonctions de lecture appelées existent hors ligne", () => {
    const re = /\.rpc\(\s*"([a-z_]+)"/g;
    const names = new Set<string>();
    const walk = (d: string) => {
      for (const e of readdirSync(d)) {
        const p = join(d, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e) && !p.includes("offline")) for (const m of readFileSync(p, "utf8").matchAll(re)) names.add(m[1]!);
      }
    };
    walk(join(root, "..", "src"));
    const reads = new Set(["my_permissions", "dashboard_stats", "revenue_report", "revenue_by_plan", "profit_and_loss", "find_member_duplicates", "refresh_notifications"]);
    for (const name of [...names].filter((n) => reads.has(n))) {
      const r = runLocalRpc(owner, name, { p_org: org, org, p_from: today, p_to: today, p_first_name: "x", p_last_name: "y" });
      if (reads.has(name)) assert(!r.error, `${name} : ${JSON.stringify(r.error)}`);
      else assert(name === "convert_lead" || name === "log_member_export" || r.error, `${name} devrait être refusée sans ses paramètres`);
    }
  });
  await test("relation imbriquée : séance, réservations, membre, coach", async () => {
    const r = await q(owner, "sessions").select("id, title, coach:coaches(full_name), bookings(id, status, member:members(first_name, member_code))").eq("id", session_).single();
    const [sql] = await asUser<{ r: { title: string; coach: string; n: number; first: string } }>(owner,
      "select json_build_object('title',s.title,'coach',c.full_name,'n',count(b.id),'first',min(m.first_name)) r from sessions s left join coaches c on c.id=s.coach_id left join bookings b on b.session_id=s.id left join members m on m.id=b.member_id where s.id=$1 group by s.title,c.full_name", [session_]);
    const d = r.data as { title: string; coach: { full_name: string }; bookings: Array<{ member: { first_name: string } }> };
    assert(d.title === sql!.r.title && d.coach.full_name === sql!.r.coach && d.bookings.length === sql!.r.n && d.bookings[0]!.member.first_name === sql!.r.first, JSON.stringify(d));
  });
  await test("filtre sur relation obligatoire : fiche coach de l'utilisateur", async () => {
    const mine = await q(coachUser, "coaches").select("id, staff!inner(user_id)").eq("organization_id", org).eq("staff.user_id", coachUser).eq("is_active", true).maybeSingle();
    assert((mine.data as { id: string } | null)?.id === coach, JSON.stringify(mine));
    const none = await q(owner, "coaches").select("id, staff!inner(user_id)").eq("organization_id", org).eq("staff.user_id", owner).maybeSingle();
    assert(none.data === null && !none.error, JSON.stringify(none));
  });
  await test("recherche sans accents ni casse imposés, caractères spéciaux sans danger", async () => {
    const search = (text: string) => q(owner, "members").select("id").eq("organization_id", org).or(`first_name.ilike.*${text}*,last_name.ilike.*${text}*,member_code.ilike.*${text}*`);
    assert(((await search("ben sa")).data as unknown[]).length === 1, "recherche par nom");
    assert(((await search("M-0000")).data as unknown[]).length === 5, "recherche par code");
    assert(((await search("(.*)")).data as unknown[]).length === 0, "motif interprété");
  });
  await test("filtres NULL, tri, pagination et comptage comme PostgreSQL", async () => {
    const coalesced = (await q(owner, "members").select("id").eq("organization_id", org).is("phone", null)).data as unknown[];
    assert(coalesced.length === 1, "is null");
    const neq = (await q(owner, "members").select("id").eq("organization_id", org).neq("phone", "x")).data as unknown[];
    assert(neq.length === 4, `neq écarte NULL comme SQL : ${neq.length}`);
    const not = (await q(owner, "members").select("id").eq("organization_id", org).not("phone", "is", null)).data as unknown[];
    assert(not.length === 4, "not is null");
    const paged = await q(owner, "members").select("id", { count: "exact" }).eq("organization_id", org).order("last_name").range(1, 2);
    assert((paged.data as unknown[]).length === 2 && paged.count === 5, JSON.stringify(paged));
    const head = await q(owner, "members").select("id", { count: "exact", head: true }).eq("organization_id", org);
    assert(head.count === 5 && head.data === null, JSON.stringify(head));
    const sorted = (await q(owner, "members").select("phone").eq("organization_id", org).order("phone", { ascending: false })).data as Array<{ phone: string | null }>;
    assert(sorted[0]!.phone === null, "desc : NULL en premier, comme PostgreSQL");
    const single = await q(owner, "members").select("id").eq("organization_id", org).single();
    assert(single.error?.code === "PGRST116" && single.data === null, "single sur plusieurs lignes");
    const gte = (await q(owner, "payments").select("id").eq("organization_id", org).gte("paid_at", new Date(Date.now() - 86_400_000).toISOString())).data as unknown[];
    assert(gte.length === 3, `filtre de date : ${gte.length}`);
  });
  await test("une forme de requête inconnue échoue au lieu de renvoyer un résultat faux", async () => {
    let threw = false;
    try {
      await q(owner, "members").select("id, nimporte:quoi(id)").eq("organization_id", org);
    } catch {
      threw = true;
    }
    assert(threw, "aucune erreur");
  });

  console.log("\nMises à jour : seulement ce qui a changé");
  await test("création, modification et suppression arrivent sur le poste", async () => {
    await writeAs(owner, "update members set first_name = 'Alicia' where id = $1", [alice]);
    const lead = (await writeAs(owner, "insert into leads (organization_id,first_name,last_name,phone) values ($1,'Nour','Nouveau','22 111') returning id", [org]))[0].id as string;
    const temp = (await writeAs(owner, "insert into leads (organization_id,first_name,last_name,phone) values ($1,'Temp','Supprimé','22 222') returning id", [org]))[0].id as string;
    await pullAll(remoteFor(owner), owner, [org]);
    assert(rowsOf(owner, "leads").some((l) => l.id === temp), "pas reçue");
    await writeAs(owner, "delete from leads where id = $1", [temp]);
    const s = await pullAll(remoteFor(owner), owner, [org]);
    assert(s.fullCopies === 0 && s.removed >= 1, JSON.stringify(s));
    assert(rowsOf(owner, "members").find((m) => m.id === alice)!.first_name === "Alicia", "modification absente");
    assert(rowsOf(owner, "leads").some((l) => l.id === lead) && !rowsOf(owner, "leads").some((l) => l.id === temp), "lignes incorrectes");
  });
  await test("une deuxième synchronisation sans changement ne télécharge rien", async () => {
    await pullAll(remoteFor(owner), owner, [org]);
    const s = await pullAll(remoteFor(owner), owner, [org]);
    assert(s.upserted === 0 && s.removed === 0 && s.fullCopies === 0, JSON.stringify(s));
  });
  await test("membre réaffecté à un autre coach : retiré du poste du coach", async () => {
    await pullAll(remoteFor(coachUser), coachUser, [org]);
    assert(rowsOf(coachUser, "members").some((m) => m.id === alice), "préalable");
    await writeAs(owner, "update members set coach_id = $2 where id = $1", [alice, coach2]);
    await pullAll(remoteFor(coachUser), coachUser, [org]);
    assert(!rowsOf(coachUser, "members").some((m) => m.id === alice), "membre encore visible");
    await writeAs(owner, "update members set coach_id = $2 where id = $1", [alice, coach]);
  });
  await test("journal purgé : le poste en retard refait une copie complète", async () => {
    await writeAs(owner, "update members set first_name = 'Alice' where id = $1", [alice]);
    await db.query("select private.sync_prune(interval '0 seconds')");
    await db.query("update private.sync_state set pruned_through = pruned_through + 1");
    const s = await pullAll(remoteFor(owner), owner, [org]);
    assert(s.fullCopies === 1, JSON.stringify(s));
    assert(rowsOf(owner, "members").find((m) => m.id === alice)!.first_name === "Alice", "copie incomplète");
  });
  await test("une panne pendant la synchronisation n'avance pas le curseur", async () => {
    const before = getMeta(reception, `cursor:${org}`);
    await writeAs(owner, "update members set first_name = 'Panne' where id = $1", [bob]);
    const broken: RemoteClient = {
      ...remoteFor(reception),
      from: () => ({ select: () => ({ in: () => Promise.resolve({ data: null, error: { message: "réseau coupé" } }) }) as never }),
    };
    let failed = false;
    try {
      await pullAll(broken, reception, [org]);
    } catch {
      failed = true;
    }
    assert(failed && getMeta(reception, `cursor:${org}`) === before, "curseur avancé malgré l'échec");
    await pullAll(remoteFor(reception), reception, [org]);
    assert(rowsOf(reception, "members").find((m) => m.id === bob)!.first_name === "Panne", "reprise incomplète");
    await writeAs(owner, "update members set first_name = 'Bob' where id = $1", [bob]);
    await pullAll(remoteFor(reception), reception, [org]);
  });

  console.log("\nProtection des données sur le poste");
  const dbFile = join(dir, "castle.db");
  await test("aucune donnée personnelle lisible dans les fichiers du poste", () => {
    rememberAccount("Rim.Accueil@test.tn", "MotDePasse1234", reception);
    for (const f of readdirSync(dir)) {
      const content = readFileSync(join(dir, f)).toString("latin1");
      for (const secret of ["Trabelsi", "alice@exemple.tn", "22 333 444", "Rim.Accueil", "rim.accueil", "MotDePasse1234", "Erreur de saisie"]) {
        assert(!content.includes(secret), `« ${secret} » lisible dans ${f}`);
      }
    }
    assert(existsSync(dbFile), "base absente");
  });
  await test("connexion hors ligne : bon mot de passe accepté, mauvais refusé", () => {
    const good = verifyAccount("rim.accueil@test.tn", "MotDePasse1234");
    assert(good.ok && good.userId === reception, JSON.stringify(good));
    assert(!verifyAccount("rim.accueil@test.tn", "faux").ok, "mauvais mot de passe accepté");
    assert(!verifyAccount("inconnu@test.tn", "MotDePasse1234").ok, "compte inconnu accepté");
  });
  await test("blocage après 5 essais, même avec le bon mot de passe ensuite", () => {
    rememberAccount("essais@test.tn", "BonMotDePasse1", owner);
    let last;
    for (let i = 0; i < 5; i++) last = verifyAccount("essais@test.tn", "faux");
    assert(last && !last.ok && last.reason === "locked", JSON.stringify(last));
    const blocked = verifyAccount("essais@test.tn", "BonMotDePasse1");
    assert(!blocked.ok && blocked.reason === "locked", JSON.stringify(blocked));
    rememberAccount("essais@test.tn", "BonMotDePasse1", owner);
  });
  await test("session hors ligne : falsification et expiration refusées", () => {
    const valid = signSession(owner, Date.now() + 60_000);
    assert(verifySession(valid) === owner, "session valide refusée");
    assert(verifySession(signSession(owner, Date.now() - 1)) === null, "session expirée acceptée");
    assert(verifySession(valid.replace(owner, reception)) === null, "identité falsifiée acceptée");
    assert(verifySession(`${owner}.${Date.now() + 60_000}.faux`) === null, "signature falsifiée acceptée");
    assert(verifySession(undefined) === null && verifySession("") === null, "cookie vide accepté");
  });
  await test("sans session valide, le client local ne lit rien", async () => {
    const client = createLocalClient(undefined);
    assert((await client.auth.getUser()).data.user === null, "utilisateur renvoyé");
    assert(((await client.from("members").select("id")).data as unknown[]).length === 0, "données renvoyées");
  });
  await test("avec une session, le client local renvoie le bon compte et ses données seulement", async () => {
    rememberAccount("coach@test.tn", "MotDePasse1234", coachUser);
    const client = createLocalClient(signSession(coachUser, Date.now() + 60_000));
    const { data } = await client.auth.getUser();
    assert(data.user?.id === coachUser && data.user.email === "coach@test.tn", JSON.stringify(data));
    assert(((await client.from("payments").select("id")).data as unknown[]).length === 0, "le coach voit des paiements");
  });
  await test("une ligne modifiée dans le fichier est détectée, jamais lue", async () => {
    const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
    closeStore();
    const raw = new DatabaseSync(dbFile);
    const row = raw.prepare("select id, data from rows where user_id = ? and tbl = 'members' limit 1").get(owner) as { id: string; data: Uint8Array };
    const data = Buffer.from(row.data);
    data[data.length - 1]! ^= 0xff;
    raw.prepare("update rows set data = ? where user_id = ? and tbl = 'members' and id = ?").run(data, owner, row.id);
    raw.close();
    let threw = false;
    try {
      rowsOf(owner, "members");
    } catch {
      threw = true;
    }
    assert(threw, "ligne falsifiée acceptée");
    forgetUser(owner);
    await pullAll(remoteFor(owner), owner, [org]);
  });
  await test("clé différente : rien n'est lu, l'application ne plante pas, la copie se reconstruit", async () => {
    rememberAccount("autre-cle@test.tn", "MotDePasse1234", owner);
    closeStore();
    const realKey = process.env.CASTLE_DATA_KEY;
    process.env.CASTLE_DATA_KEY = randomBytes(32).toString("base64");
    assert(rowsOf(owner, "members").length === 0, "ancienne copie encore présente");
    assert(getMeta(owner, "last_sync") === null, "ancien horodatage encore présent");
    assert(!verifyAccount("autre-cle@test.tn", "MotDePasse1234").ok, "ancienne connexion hors ligne encore valable");
    const s = await pullAll(remoteFor(owner), owner, [org]);
    assert(s.fullCopies === 1 && rowsOf(owner, "members").length === 5, JSON.stringify(s));
    closeStore();
    process.env.CASTLE_DATA_KEY = realKey;
    await pullAll(remoteFor(owner), owner, [org]);
    assert(rowsOf(owner, "members").length === 5, "copie non reconstruite avec la clé d'origine");
  });
  await test("même clé au redémarrage : la copie est conservée", () => {
    const before = rowsOf(owner, "members").length;
    closeStore();
    assert(before === 5 && rowsOf(owner, "members").length === 5, "copie perdue au redémarrage");
    assert(getMeta(owner, "last_sync") !== null, "horodatage perdu au redémarrage");
  });
  await test("une écriture interrompue ne laisse rien à moitié", () => {
    const before = rowsOf(owner, "leads").length;
    const cursor = getMeta(owner, `cursor:${org}`);
    let threw = false;
    try {
      applyBatch(owner, {
        upsert: [{ table: "leads", id: "x", org, row: { id: "x" } }, { table: "leads", id: null as never, org, row: {} }],
        meta: { [`cursor:${org}`]: "999999" },
      });
    } catch {
      threw = true;
    }
    assert(threw && rowsOf(owner, "leads").length === before && getMeta(owner, `cursor:${org}`) === cursor, "écriture partielle");
  });
  await test("compte retiré : données et connexion hors ligne effacées du poste", () => {
    rememberAccount("coach@test.tn", "MotDePasse1234", coachUser);
    forgetUser(coachUser);
    assert(rowsOf(coachUser, "members").length === 0, "données restantes");
    assert(!verifyAccount("coach@test.tn", "MotDePasse1234").ok, "connexion encore possible");
  });

  // =========================================================================
  // Écritures hors ligne : file d'attente et rejeu
  // =========================================================================
  console.log("\nÉcritures hors ligne");
  const session = (u: string) => createLocalClient(signSession(u, Date.now() + 3_600_000));
  const flush = (u: string) => syncAll(remoteFor(u), u, [org]);
  for (const u of [owner, reception, coachUser]) {
    await registerDevice(remoteFor(u), [org], "Test");
    await pullAll(remoteFor(u), u, [org], [org]);
  }
  const serverRow = async (table: string, id: string) =>
    (await db.query("select to_json(t) r from public." + table + " t where id::text = $1", [id])).rows[0]?.r as Record<string, unknown> | undefined;
  const newLocalMember = async (u: string, first: string, last: string, phone = "20 000 000") =>
    ((await session(u).from("members").insert({ organization_id: org, first_name: first, last_name: last, phone } as never).select("id, member_code").single()).data as unknown as { id: string; member_code: string });

  await test("les colonnes générées correspondent au schéma réel", async () => {
    const expected = renderColumns(await readColumns(db, WRITABLE_TABLES)).replace(/\r\n/g, "\n");
    const actual = readFileSync(join(root, "..", "src", "lib", "offline", "columns.generated.ts"), "utf8").replace(/\r\n/g, "\n");
    assert(actual === expected, "fichier périmé : lancez npm run db:columns");
  });
  await test("entrée hors ligne : visible tout de suite, en attente, puis sur le serveur avec le même identifiant", async () => {
    const m = await newLocalMember(reception, "Hors", "Entree");
    await flush(reception);
    await writeAs(owner, "select create_subscription($1,$2,$3,$4)", [org, m.id, monthly, randomUUID()]);
    await pullAll(remoteFor(reception), reception, [org]);
    const r = (await session(reception).rpc("check_in", { p_org: org, p_member: m.id, p_method: "qr" })).data as { result: string; attendance_id: string; checked_in_at: string };
    assert(r.result === "granted", JSON.stringify(r));
    assert(rowsOf(reception, "attendance").some((a) => a.id === r.attendance_id), "absente de la copie");
    assert(pendingCount(reception) === 1, String(pendingCount(reception)));
    assert(!(await serverRow("attendance", r.attendance_id)), "déjà sur le serveur");
    await flush(reception);
    assert(pendingCount(reception) === 0, "file non vidée");
    const s = await serverRow("attendance", r.attendance_id);
    assert(s && Math.abs(Date.parse(s.checked_in_at as string) - Date.parse(r.checked_in_at)) < 1000, JSON.stringify(s));
  });
  await test("deuxième scan rapproché : doublon reconnu, aucune opération ajoutée", async () => {
    const m = rowsOf(reception, "members").find((x) => x.last_name === "Entree")!;
    const r = (await session(reception).rpc("check_in", { p_org: org, p_member: m.id, p_method: "qr" })).data as { result: string };
    assert(r.result === "duplicate" && pendingCount(reception) === 0, JSON.stringify(r));
  });
  await test("mêmes règles qu'en ligne : refus sans abonnement, forçage réservé au propriétaire", async () => {
    const m = await newLocalMember(reception, "Sans", "Abonnement");
    const denied = (await session(reception).rpc("check_in", { p_org: org, p_member: m.id, p_method: "search" })).data as { result: string; can_override: boolean };
    assert(denied.result === "denied" && !denied.can_override, JSON.stringify(denied));
    const forced = await session(reception).rpc("check_in", { p_org: org, p_member: m.id, p_method: "search", p_override_reason: "VIP" });
    assert(forced.error?.code === "42501", JSON.stringify(forced));
    await flush(reception);
    await pullAll(remoteFor(owner), owner, [org]);
    const ok1 = (await session(owner).rpc("check_in", { p_org: org, p_member: m.id, p_method: "search", p_override_reason: "Essai offert" })).data as { result: string; attendance_id: string };
    assert(ok1.result === "granted", JSON.stringify(ok1));
    await flush(owner);
    assert((await serverRow("attendance", ok1.attendance_id))?.override_reason === "Essai offert", "motif perdu");
  });
  await test("ce qu'on voit hors ligne est exactement ce que le serveur enregistre : membre, abonnement, paiement, remboursement", async () => {
    await pullAll(remoteFor(owner), owner, [org]);
    const c = session(owner);
    const m = await newLocalMember(owner, "Chaine", "Complete", "+216 21 222 333");
    const request = randomUUID();
    const sub = (await c.rpc("create_subscription", { p_org: org, p_member: m.id, p_plan: monthly, p_request_id: request, p_start: null, p_discount: 5, p_notes: "Hors ligne" })).data as string;
    const pay = (await c.rpc("record_payment", { p_org: org, p_member: m.id, p_method: cash, p_amount: 40.5, p_request_id: randomUUID(), p_subscription: sub })).data as Array<{ payment_id: string; receipt_number: string }>;
    assert(/^R-[A-Z]+-\d{4}-\d{6}$/.test(pay[0]!.receipt_number), pay[0]!.receipt_number);
    assert(/^M-[A-Z]+-\d{6}$/.test(m.member_code), m.member_code);
    const refund = await c.rpc("refund_payment", { p_org: org, p_payment: pay[0]!.payment_id, p_type: "refund", p_amount: 0.5, p_reason: "Erreur de saisie", p_request_id: randomUUID() });
    assert(!refund.error, JSON.stringify(refund));

    const pick = (row: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map((k) => [k, row[k] ?? null]));
    const memberKeys = ["first_name", "last_name", "full_name", "member_code", "phone", "phone_digits", "registered_on", "membership_end_date", "membership_suspended", "membership_status", "coach_name"];
    const subKeys = ["plan_name", "kind", "start_date", "end_date", "price", "discount", "total_due", "amount_paid", "balance", "payment_status", "effective_status", "status", "notes", "request_id", "member_code", "member_name"];
    const payKeys = ["amount", "refunded_amount", "net_amount", "receipt_number", "method_name", "member_name", "member_code", "plan_name", "request_id"];
    const localView = async (view: string, column: string, value: string) => (await q(owner, view).select("*").eq(column, value)).data as Array<Record<string, unknown>>;
    const seenMember = pick((await localView("member_directory", "id", m.id))[0]!, memberKeys);
    const seenSub = pick((await localView("subscription_overview", "member_id", m.id))[0]!, subKeys);
    const seenPay = pick((await localView("payment_ledger", "member_id", m.id))[0]!, payKeys);

    const outcome = await flush(owner);
    assert(outcome.status === "ok" && outcome.pushed.rejected === 0 && outcome.pushed.conflicts === 0, JSON.stringify(outcome));
    const sql = async (view: string, column: string) => (await db.query("select to_json(t) r from public." + view + " t where " + column + "::text = $1", [m.id])).rows.map((x) => x.r as Record<string, unknown>);
    assertSame(seenMember, pick((await sql("member_directory", "id"))[0]!, memberKeys), "membre");
    assertSame(seenSub, pick((await sql("subscription_overview", "member_id"))[0]!, subKeys), "abonnement");
    assertSame(seenPay, pick((await sql("payment_ledger", "member_id"))[0]!, payKeys), "paiement");
    assert((await q(owner, "subscriptions").select("id").eq("member_id", m.id)).data !== null, "copie vide");
    assert(rowsOf(owner, "subscriptions").every((s) => !s._offline), "ligne provisoire restante");
  });
  await test("suspension, reprise, prolongation et annulation : mêmes résultats que le serveur", async () => {
    const c = session(owner);
    const m = await newLocalMember(owner, "Cycle", "Abonnement");
    const start = (await db.query("select ((now() at time zone 'Africa/Tunis')::date - 3)::text d")).rows[0].d as string;
    const sub = (await c.rpc("create_subscription", { p_org: org, p_member: m.id, p_plan: monthly, p_request_id: randomUUID(), p_start: start })).data as string;
    const keys = ["status", "start_date", "end_date", "suspended_on", "cancel_reason"];
    const memberKeys = ["membership_end_date", "membership_suspended"];
    const compare = async (what: string) => {
      const pickRow = (r: Record<string, unknown>, ks: string[]) => Object.fromEntries(ks.map((k) => [k, r[k] ?? null]));
      const seen = rowsOf(owner, "subscriptions").find((s) => s.member_id === m.id)!;
      const seenM = rowsOf(owner, "members").find((x) => x.id === m.id)!;
      const expectSub = pickRow(seen, keys);
      const expectMember = pickRow(seenM, memberKeys);
      const out = await flush(owner);
      assert(out.pushed.rejected === 0, what + " : " + JSON.stringify(out.pushed));
      const srv = (await db.query("select to_json(s) r from subscriptions s where member_id = $1", [m.id])).rows[0].r;
      const srvM = await serverRow("members", m.id);
      assertSame(expectSub, pickRow(srv, keys), what);
      assertSame(expectMember, pickRow(srvM!, memberKeys), what + " (membre)");
      return srv.id as string;
    };
    let id = await compare("création");
    assert(!(await c.rpc("suspend_subscription", { p_org: org, p_sub: id, p_reason: "Blessure" })).error, "suspension");
    id = await compare("suspension");
    assert(!(await c.rpc("resume_subscription", { p_org: org, p_sub: id, p_reason: null })).error, "reprise");
    id = await compare("reprise");
    assert(!(await c.rpc("extend_subscription", { p_org: org, p_sub: id, p_days: 10, p_reason: "Geste commercial" })).error, "prolongation");
    id = await compare("prolongation");
    assert(!(await c.rpc("cancel_subscription", { p_org: org, p_sub: id, p_reason: "Départ" })).error, "annulation");
    await compare("annulation");
    void sub;
  });
  await test("dates de fin identiques à PostgreSQL, y compris fins de mois et années bissextiles", async () => {
    for (const start of ["2026-01-15", "2026-01-31", "2024-01-31", "2024-02-29", "2026-03-31", "2026-08-31", "2026-12-31", "2027-02-28"]) {
      for (const [value, unit] of [[1, "day"], [7, "day"], [1, "week"], [1, "month"], [3, "month"], [6, "month"], [1, "year"]] as const) {
        const sql = (await db.query("select private.compute_end_date($1::date,$2,$3::public.duration_unit)::text d", [start, value, unit])).rows[0].d;
        assert(computeEndDate(start, value, unit) === sql, start + " + " + value + " " + unit + " : " + computeEndDate(start, value, unit) + " au lieu de " + sql);
      }
    }
  });
  await test("chaque type de fiche créé hors ligne a la même forme que sur le serveur", async () => {
    const c = session(owner);
    const made: Array<[string, string]> = [];
    const add = async (table: string, values: Record<string, unknown>) => {
      const r = await c.from(table).insert({ organization_id: org, ...values } as never).select("id").single();
      assert(!r.error, table + " : " + JSON.stringify(r.error));
      made.push([table, (r.data as unknown as { id: string }).id]);
      return (r.data as unknown as { id: string }).id;
    };
    const member = await add("members", { first_name: "Forme", last_name: "Identique", phone: "22 123 456", email: "forme@exemple.tn" });
    const coachNew = await add("coaches", { full_name: "Coach Local", specialties: ["Yoga", "Boxe"], availability: [{ day: 1, start: "08:00", end: "10:00" }] });
    await add("leads", { first_name: "Lead", last_name: "Local", phone: "22 000 001", coach_id: coachNew });
    await add("expenses", { category: "other", amount: 12.5, spent_on: today, description: "Eau" });
    const eq = await add("equipment", { name: "Vélo" });
    await add("equipment_maintenance", { equipment_id: eq, performed_on: today, description: "Graissage", next_due_on: "2030-01-01" });
    await add("sessions", { kind: "group_class", title: "Boxe", coach_id: coachNew, starts_at: "2030-01-01T10:00:00+00:00", ends_at: "2030-01-01T11:00:00+00:00", capacity: 5 });
    await add("membership_plans", { name: "Pass local", kind: "pass", duration_value: 1, duration_unit: "day", price: 10 });
    await add("payment_methods", { name: "Virement local", code: "other" });
    const prog = await add("workout_programs", { name: "Local", member_id: member });
    const dayId = await add("workout_days", { program_id: prog, day_number: 1, title: "Jambes", position: 1 });
    await add("workout_exercises", { day_id: dayId, name: "Fente", position: 0 });
    await add("workout_logs", { program_id: prog, member_id: member, performed_on: today, completed: true });
    await add("progress_entries", { member_id: member, recorded_on: today, weight_kg: 70.5 });
    await add("member_notes", { member_id: member, body: "Note locale" });
    await add("announcements", { title: "Fermeture", body: "Lundi" });

    const seen = made.map(([table, id]) => ({ table, id, row: { ...rowsOf(owner, table).find((r) => r.id === id)! } }));
    const out = await flush(owner);
    assert(out.pushed.rejected === 0 && out.pushed.conflicts === 0, JSON.stringify(out.pushed));
    const ignore = new Set(["created_at", "updated_at", "row_version", "_offline", "last_activity_at"]);
    for (const { table, id, row } of seen) {
      const srv = await serverRow(table, id);
      assert(srv, table + " absent du serveur");
      assertSame(
        Object.fromEntries(Object.entries(row).filter(([k]) => !ignore.has(k))),
        Object.fromEntries(Object.entries(srv).filter(([k]) => !ignore.has(k))),
        table,
      );
    }
    assert((await serverRow("equipment", eq))!.next_maintenance_on === "2030-01-01", "prochain entretien non mis à jour");
  });
  await test("modifier puis supprimer hors ligne : appliqué dans l'ordre", async () => {
    const c = session(owner);
    const lead = (await c.from("leads").insert({ organization_id: org, first_name: "Ordre", last_name: "Test", phone: "22 000 002" } as never).select("id").single()).data as unknown as { id: string };
    const u = await c.from("leads").update({ first_name: "Modifié" } as never, { count: "exact" }).eq("id", lead.id);
    assert(u.count === 1, JSON.stringify(u));
    const d = await c.from("leads").delete({ count: "exact" }).eq("id", lead.id);
    assert(d.count === 1, JSON.stringify(d));
    const out = await flush(owner);
    assert(out.pushed.rejected === 0 && out.pushed.conflicts === 0, JSON.stringify(out.pushed));
    assert(!(await serverRow("leads", lead.id)), "toujours sur le serveur");
  });
  await test("réservation puis annulation hors ligne : l'identifiant du serveur est retrouvé", async () => {
    const c = session(owner);
    const m = await newLocalMember(owner, "Resa", "Locale");
    const b = (await c.rpc("book_session", { p_org: org, p_session: session_, p_member: m.id })).data as string;
    assert(rowsOf(owner, "bookings").some((x) => x.id === b && x.status === "booked"), "non visible");
    const again = await c.rpc("book_session", { p_org: org, p_session: session_, p_member: m.id });
    assert(again.error?.code === "23505", JSON.stringify(again));
    assert(!(await c.rpc("cancel_booking", { p_org: org, p_booking: b })).error, "annulation");
    const out = await flush(owner);
    assert(out.pushed.rejected === 0, JSON.stringify(out.pushed));
    const srv = (await db.query("select status from bookings where member_id = $1", [m.id])).rows;
    assert(srv.length === 1 && srv[0].status === "cancelled", JSON.stringify(srv));
  });
  await test("sortie et correction d'un passage fait hors ligne", async () => {
    const c = session(owner);
    const m = rowsOf(owner, "members").find((x) => x.last_name === "Entree")!;
    await db.query("update attendance set status = 'voided' where member_id = $1", [m.id]);
    await pullAll(remoteFor(owner), owner, [org]);
    const a = (await c.rpc("check_in", { p_org: org, p_member: m.id, p_method: "manual" })).data as { attendance_id: string };
    assert(!(await c.rpc("check_out", { p_org: org, p_attendance: a.attendance_id })).error, "sortie");
    assert(!(await c.rpc("correct_attendance", { p_org: org, p_attendance: a.attendance_id, p_reason: "Erreur de scan", p_void: true })).error, "correction");
    const out = await flush(owner);
    assert(out.pushed.rejected === 0, JSON.stringify(out.pushed));
    const srv = await serverRow("attendance", a.attendance_id);
    assert(srv?.status === "voided" && srv.checked_out_at && srv.correction_reason === "Erreur de scan", JSON.stringify(srv));
  });

  console.log("\nConflits et refus au rejeu");
  await test("même champ modifié ailleurs : la valeur du serveur reste, l'autre champ passe, revue possible", async () => {
    const c = session(reception);
    await pullAll(remoteFor(reception), reception, [org]);
    await writeAs(owner, "update members set phone = '11 111 111' where id = $1", [dali]);
    const u = await c.from("members").update({ phone: "99 999 999", address: "Sfax" } as never).eq("id", dali);
    assert(!u.error, JSON.stringify(u));
    assert(rowsOf(reception, "members").find((x) => x.id === dali)!.phone === "99 999 999", "effet local absent");
    const out = await flush(reception);
    assert(out.pushed.conflicts === 1, JSON.stringify(out.pushed));
    const srv = await serverRow("members", dali);
    assert(srv!.phone === "11 111 111" && srv!.address === "Sfax", JSON.stringify(srv));
    const local = rowsOf(reception, "members").find((x) => x.id === dali)!;
    assert(local.phone === "11 111 111" && local.address === "Sfax", "copie locale différente du serveur");
    const review = await asUser<{ status: string; conflicts: Array<{ field: string }> }>(reception, "select status, conflicts from sync_ops where status = 'conflict' and resolved_at is null order by created_at desc limit 1");
    assert(review[0]?.conflicts[0]?.field === "phone", JSON.stringify(review));
  });
  await test("deux postes vendent le même abonnement : refus enregistré, la file continue, la copie se corrige", async () => {
    const m = await newLocalMember(reception, "Double", "Vente");
    await flush(reception);
    await writeAs(owner, "select create_subscription($1,$2,$3,$4)", [org, m.id, monthly, randomUUID()]);
    const c = session(reception);
    assert(!(await c.rpc("create_subscription", { p_org: org, p_member: m.id, p_plan: monthly, p_request_id: randomUUID() })).error, "vente locale");
    const a = (await c.rpc("check_in", { p_org: org, p_member: m.id, p_method: "qr" })).data as { attendance_id: string };
    const out = await flush(reception);
    assert(out.pushed.rejected === 1 && out.pushed.applied === 1, JSON.stringify(out.pushed));
    assert(await serverRow("attendance", a.attendance_id), "l'opération suivante n'est pas passée");
    assert(rowsOf(reception, "subscriptions").filter((s) => s.member_id === m.id).length === 1, "abonnement refusé encore visible");
    const n = (await db.query("select count(*) n from subscriptions where member_id = $1", [m.id])).rows[0].n;
    assert(n === "1", n + " abonnements");
    const review = await asUser<{ error_message: string }>(reception, "select error_message from sync_ops where status = 'rejected' and kind = 'create_subscription' order by created_at desc limit 1");
    assert(/déjà une adhésion/.test(review[0]!.error_message), JSON.stringify(review));
  });
  await test("trop-perçu entre deux postes : le second refusé, le solde reste juste", async () => {
    const m = await newLocalMember(reception, "Solde", "Juste");
    await flush(reception);
    const sub = (await writeAs(owner, "select create_subscription($1,$2,$3,$4) id", [org, m.id, monthly, randomUUID()]))[0].id as string;
    await pullAll(remoteFor(reception), reception, [org]);
    await writeAs(owner, "select * from record_payment($1,$2,$3,80,$4,$5)", [org, m.id, cash, randomUUID(), sub]);
    assert(!(await session(reception).rpc("record_payment", { p_org: org, p_member: m.id, p_method: cash, p_amount: 80, p_request_id: randomUUID(), p_subscription: sub })).error, "paiement local");
    const out = await flush(reception);
    assert(out.pushed.rejected === 1, JSON.stringify(out.pushed));
    const s = (await db.query("select amount_paid from subscriptions where id = $1", [sub])).rows[0];
    assert(s.amount_paid === "80.000", s.amount_paid);
    assert(Number(rowsOf(reception, "subscriptions").find((x) => x.id === sub)!.amount_paid) === 80, "copie locale fausse");
  });
  await test("suppression d'une fiche modifiée ailleurs : conservée, conflit signalé", async () => {
    const lead = (await writeAs(owner, "insert into leads (organization_id,first_name,last_name,phone) values ($1,'Garde','Moi','22 111 222') returning id", [org]))[0].id as string;
    await pullAll(remoteFor(reception), reception, [org]);
    await writeAs(owner, "update leads set first_name = 'Modifié' where id = $1", [lead]);
    await session(reception).from("leads").delete().eq("id", lead);
    assert(!rowsOf(reception, "leads").some((l) => l.id === lead), "effet local absent");
    const out = await flush(reception);
    assert(out.pushed.conflicts === 1, JSON.stringify(out.pushed));
    assert(await serverRow("leads", lead), "fiche supprimée sur le serveur");
    assert(rowsOf(reception, "leads").some((l) => l.id === lead), "fiche non revenue sur le poste");
  });
  await test("heure du poste dans le futur : refus clair, pas de date fausse", async () => {
    applyBatch(reception, { enqueue: [{ opId: randomUUID(), user: reception, org, kind: "check_in", args: { member: bob, method: "qr" }, occurredAt: new Date(Date.now() + 86_400_000).toISOString(), label: "Entrée" }] });
    const out = await flush(reception);
    assert(out.pushed.rejected === 1, JSON.stringify(out.pushed));
  });

  console.log("\nCoupures pendant l'envoi");
  await test("réseau coupé au milieu : rien de perdu ni de doublé, l'envoi reprend où il s'était arrêté", async () => {
    const c = session(reception);
    const m = await newLocalMember(reception, "Coupure", "Reseau");
    const request = randomUUID();
    assert(!(await c.rpc("record_payment", { p_org: org, p_member: m.id, p_method: cash, p_amount: 15, p_request_id: request })).error, "paiement");
    assert(pendingCount(reception) === 2, String(pendingCount(reception)));
    const real = remoteFor(reception);
    let calls = 0;
    const flaky: RemoteClient = {
      ...real,
      rpc: async (name, args) => {
        if (name === "sync_apply_op" && ++calls === 2) {
          // Le serveur enregistre, mais la réponse se perd : le pire cas.
          await real.rpc(name, args);
          return { data: null, error: { message: "réseau coupé" } };
        }
        return real.rpc(name, args);
      },
    };
    const first = await syncAll(flaky, reception, [org]);
    assert(first.status === "pending" && first.pushed.error === "réseau coupé", JSON.stringify(first));
    assert(pendingCount(reception) === 1, "file incorrecte");
    assert(rowsOf(reception, "payments").some((p) => p.request_id === request), "effet local écrasé pendant la coupure");
    const second = await flush(reception);
    assert(second.status === "ok" && pendingCount(reception) === 0, JSON.stringify(second));
    const n = (await db.query("select count(*) n from payments where request_id = $1", [request])).rows[0].n;
    assert(n === "1", n + " paiements");
  });
  await test("session expirée : la file attend, sans erreur ni perte", async () => {
    const m = rowsOf(reception, "members").find((x) => x.last_name === "Reseau")!;
    await session(reception).from("members").update({ address: "Attente" } as never).eq("id", m.id);
    const expired: RemoteClient = { ...remoteFor(reception), rpc: async () => ({ data: null, error: { message: "JWT expired" } }) };
    const out = await pushQueue(expired, reception);
    assert(out.error === "JWT expired" && pendingCount(reception) === 1, JSON.stringify(out));
    await flush(reception);
    assert((await serverRow("members", m.id as string))!.address === "Attente", "modification perdue");
  });

  console.log("\nDroits et isolement");
  await test("droits vérifiés sur le poste : rien en file pour une action interdite", async () => {
    const before = pendingCount(reception);
    const refused = await session(reception).rpc("refund_payment", { p_org: org, p_payment: p1, p_type: "refund", p_amount: 1, p_reason: "Essai", p_request_id: randomUUID() });
    assert(refused.error?.code === "42501", JSON.stringify(refused));
    const coachWrite = await session(coachUser).from("members").insert({ organization_id: org, first_name: "X", last_name: "Y" } as never);
    assert(coachWrite.error?.code === "42501", JSON.stringify(coachWrite));
    assert(pendingCount(reception) === before && pendingCount(coachUser) === 0, "opération en file");
  });
  await test("les actions impossibles sans Internet le disent clairement", async () => {
    for (const r of [
      await session(owner).from("staff").update({ role: "owner" } as never).eq("user_id", owner),
      await session(owner).rpc("convert_lead", { p_org: org, p_lead: bob }),
      await session(owner).rpc("log_member_export", { p_org: org, p_count: 1, p_filters: {} }),
    ]) {
      assert(/nécessite Internet/.test(r.error?.message ?? ""), JSON.stringify(r));
    }
    assert(pendingCount(owner) === 0, "opération en file");
  });
  await test("chaque compte n'envoie que ses propres actions, sous sa propre identité", async () => {
    await session(owner).from("members").update({ address: "Par propriétaire" } as never).eq("id", bob);
    await session(reception).from("members").update({ address: "Par accueil" } as never).eq("id", emna);
    const out = await pushQueue(remoteFor(reception), reception);
    assert(out.sent === 1 && pendingCount(owner) === 1, JSON.stringify(out));
    assert((await serverRow("members", bob))!.address !== "Par propriétaire", "action d'un autre compte envoyée");
    await flush(owner);
    await flush(reception);
    const who = (await db.query("select user_id from sync_ops where args->'changes'->>'address' = 'Par propriétaire'")).rows[0];
    assert(who.user_id === owner, "mauvaise identité");
  });
  await test("le même paiement validé deux fois (double clic) ne crée qu'une opération", async () => {
    const c = session(reception);
    const before = pendingCount(reception);
    const request = randomUUID();
    const one = (await c.rpc("record_payment", { p_org: org, p_member: bob, p_method: cash, p_amount: 1, p_request_id: request })).data as Array<{ payment_id: string }>;
    const two = (await c.rpc("record_payment", { p_org: org, p_member: bob, p_method: cash, p_amount: 1, p_request_id: request })).data as Array<{ payment_id: string }>;
    assert(one[0]!.payment_id === two[0]!.payment_id && pendingCount(reception) === before + 1, "doublon");
    await flush(reception);
  });
  await test("employé désactivé : ses actions restent tracées côté serveur et refusées", async () => {
    await session(reception).from("members").update({ address: "Par compte désactivé" } as never).eq("id", bob);
    await db.query("update staff set is_active = false where user_id = $1", [reception]);
    const out = await pushQueue(remoteFor(reception), reception);
    await db.query("update staff set is_active = true where user_id = $1", [reception]);
    assert(out.rejected === 1 && pendingCount(reception) === 0, JSON.stringify(out));
    assert((await serverRow("members", bob))!.address !== "Par compte désactivé", "modification enregistrée malgré la désactivation");
    const trace = await db.query("select status from sync_ops where args->'changes'->>'address' = 'Par compte désactivé'");
    assert(trace.rows[0].status === "rejected", "aucune trace");
    await pullAll(remoteFor(reception), reception, [org], [org]);
  });
  await test("la file est chiffrée : aucune donnée lisible en attente d'envoi", async () => {
    await session(reception).from("members").update({ address: "Rue-Secrete-En-Attente" } as never).eq("id", bob);
    for (const f of readdirSync(dir).filter((x) => x.startsWith("castle"))) {
      assert(!readFileSync(join(dir, f)).toString("latin1").includes("Rue-Secrete-En-Attente"), "donnée lisible dans " + f);
    }
    await flush(reception);
  });
  await test("clé différente avec des actions en attente : ancienne copie mise de côté, jamais effacée", async () => {
    await session(reception).from("members").update({ address: "Avant changement de clé" } as never).eq("id", bob);
    assert(pendingCount(reception) === 1, "préalable");
    closeStore();
    const realKey = process.env.CASTLE_DATA_KEY;
    const before = readdirSync(dir).filter((x) => x.startsWith("castle-illisible")).length;
    process.env.CASTLE_DATA_KEY = randomBytes(32).toString("base64");
    assert(pendingCount(reception) === 0, "file lue avec une autre clé");
    assert(readdirSync(dir).filter((x) => x.startsWith("castle-illisible")).length > before, "ancienne copie non conservée");
    closeStore();
    process.env.CASTLE_DATA_KEY = realKey;
    for (const u of [owner, reception, coachUser]) {
      await registerDevice(remoteFor(u), [org], "Test");
      await pullAll(remoteFor(u), u, [org], [org]);
    }
  });

  if (keepDir) {
    await pullAll(remoteFor(coachUser), coachUser, [org]);
    rememberAccount("essais@test.tn", "BonMotDePasse1", owner);
    const expires = Date.now() + 12 * 3_600_000;
    writeFileSync(join(dir, "seed.json"), JSON.stringify({
      key: process.env.CASTLE_DATA_KEY, dir, org, member: alice, payment: p1, program,
      ownerCookie: signSession(owner, expires), coachCookie: signSession(coachUser, expires),
    }));
  }
  closeStore();
  await db.end();
  if (!keepDir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  console.log(`\n${passed} réussis, ${failures.length} échoués`);
  if (failures.length) {
    console.log(failures.map((f) => ` - ${f.split("\n")[0]}`).join("\n"));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
