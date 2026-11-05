import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

/**
 * Copie locale chiffrée (SQLite + AES-256-GCM). Chaque ligne n'est lisible que
 * par le compte qui l'a téléchargée, sous sa RLS : un coach n'a donc sur le poste
 * que ce qu'un coach voit en ligne. La clé vient de l'application de bureau, qui
 * la protège avec le coffre de Windows ; elle n'est jamais écrite à côté des données.
 */
export type Row = Record<string, unknown>;

interface StoreState {
  db: DatabaseSync;
  key: Buffer;
  cache: Map<string, Row[]>;
}

const holder = globalThis as unknown as { __castleStore?: StoreState };

const keyCheck = (key: Buffer) => createHmac("sha256", key).update("castle-store-key-check").digest("hex");

function keyMismatch(db: DatabaseSync, key: Buffer): boolean {
  const saved = db.prepare("select v from store_info where k = 'key_check'").get() as { v: string } | undefined;
  return saved !== undefined && saved.v !== keyCheck(key);
}

function state(): StoreState {
  if (holder.__castleStore) return holder.__castleStore;
  const dir = process.env.CASTLE_DATA_DIR;
  const key = Buffer.from(process.env.CASTLE_DATA_KEY ?? "", "base64");
  if (!dir || key.length !== 32) throw new Error("Stockage local indisponible : clé ou dossier manquant");
  mkdirSync(dir, { recursive: true });
  const { DatabaseSync: Database } = process.getBuiltinModule("node:sqlite");
  const file = join(dir, "castle.db");
  let db = new Database(file);
  db.exec("create table if not exists store_info (k text primary key, v text not null) without rowid");
  if (keyMismatch(db, key)) {
    // Copie illisible avec cette clé : mise de côté, jamais effacée, car elle peut
    // contenir des actions pas encore envoyées. Le poste repart avec une nouvelle série.
    db.close();
    const aside = join(dir, `castle-illisible-${Date.now()}.db`);
    renameSync(file, aside);
    for (const suffix of ["-wal", "-shm"]) if (existsSync(file + suffix)) renameSync(file + suffix, aside + suffix);
    console.error("[stockage] clé différente : ancienne copie mise de côté, nouveau téléchargement à la prochaine synchronisation");
    db = new Database(file);
    db.exec("create table if not exists store_info (k text primary key, v text not null) without rowid");
  }
  db.exec(`
    pragma journal_mode = wal;
    pragma synchronous = normal;
    create table if not exists rows (
      user_id text not null, tbl text not null, id text not null, org text not null, data blob not null,
      primary key (user_id, tbl, id)
    ) without rowid;
    create index if not exists rows_org on rows (user_id, tbl, org);
    create table if not exists meta (user_id text not null, k text not null, v blob not null, primary key (user_id, k)) without rowid;
    create table if not exists accounts (
      email_mac text primary key, user_id text not null, email blob not null, salt blob not null, hash blob not null,
      failed integer not null default 0, locked_until integer not null default 0
    ) without rowid;
    create table if not exists queue (
      seq integer primary key autoincrement, user_id text not null, org text not null, op_id text not null unique,
      kind text not null, occurred_at text not null, data blob not null
    );
    create index if not exists queue_user on queue (user_id, seq);
  `);
  db.prepare("insert or ignore into store_info (k, v) values ('key_check', ?)").run(keyCheck(key));
  db.prepare("insert or ignore into store_info (k, v) values ('device_id', ?)").run(randomUUID());
  holder.__castleStore = { db, key, cache: new Map() };
  return holder.__castleStore;
}

/** Ferme la base (tests). */
export function closeStore(): void {
  holder.__castleStore?.db.close();
  holder.__castleStore = undefined;
}

function encrypt(plain: Buffer, aad: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", state().key, iv);
  cipher.setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

function decrypt(blob: Uint8Array, aad: string): Buffer {
  const buf = Buffer.from(blob);
  const decipher = createDecipheriv("aes-256-gcm", state().key, buf.subarray(0, 12));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
}

const rowAad = (user: string, table: string, id: string) => `${user}|${table}|${id}`;

/** Toutes les lignes d'une table pour ce compte (déchiffrées, gardées en mémoire). */
export function rowsOf(user: string, table: string): Row[] {
  const { db, cache } = state();
  const cacheKey = `${user}|${table}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  const stored = db.prepare("select id, data from rows where user_id = ? and tbl = ?").all(user, table) as Array<{ id: string; data: Uint8Array }>;
  const rows = stored.map((r) => JSON.parse(decrypt(r.data, rowAad(user, table, r.id)).toString("utf8")) as Row);
  cache.set(cacheKey, rows);
  return rows;
}

/** Action faite hors ligne, en attente d'envoi au serveur. */
export interface QueuedOp {
  seq?: number;
  opId: string;
  user: string;
  org: string;
  kind: string;
  args: Record<string, unknown>;
  occurredAt: string;
  label: string;
}

export interface WriteBatch {
  /** Copie complète d'une table pour une salle : remplace tout ce qui existe. */
  replace?: Array<{ table: string; org: string; rows: Array<{ id: string; org: string; row: Row }> }>;
  upsert?: Array<{ table: string; id: string; org: string; row: Row }>;
  remove?: Array<{ table: string; id: string }>;
  meta?: Record<string, string>;
  /** Écrites avec les données : un effet local n'existe jamais sans son opération. */
  enqueue?: QueuedOp[];
}

/** Écrit tout ou rien : un curseur n'avance jamais sans ses données. */
export function applyBatch(user: string, batch: WriteBatch): void {
  const { db, cache } = state();
  const put = db.prepare("insert into rows (user_id, tbl, id, org, data) values (?, ?, ?, ?, ?) on conflict (user_id, tbl, id) do update set org = excluded.org, data = excluded.data");
  const touched = new Set<string>();
  db.exec("begin immediate");
  try {
    for (const r of batch.replace ?? []) {
      db.prepare("delete from rows where user_id = ? and tbl = ? and org = ?").run(user, r.table, r.org);
      for (const x of r.rows) put.run(user, r.table, x.id, x.org, encrypt(Buffer.from(JSON.stringify(x.row)), rowAad(user, r.table, x.id)));
      touched.add(r.table);
    }
    for (const x of batch.upsert ?? []) {
      put.run(user, x.table, x.id, x.org, encrypt(Buffer.from(JSON.stringify(x.row)), rowAad(user, x.table, x.id)));
      touched.add(x.table);
    }
    for (const x of batch.remove ?? []) {
      db.prepare("delete from rows where user_id = ? and tbl = ? and id = ?").run(user, x.table, x.id);
      touched.add(x.table);
    }
    const setMeta = db.prepare("insert into meta (user_id, k, v) values (?, ?, ?) on conflict (user_id, k) do update set v = excluded.v");
    for (const [k, v] of Object.entries(batch.meta ?? {})) setMeta.run(user, k, encrypt(Buffer.from(v), `${user}|meta|${k}`));
    const addOp = db.prepare("insert into queue (user_id, org, op_id, kind, occurred_at, data) values (?, ?, ?, ?, ?, ?)");
    for (const op of batch.enqueue ?? []) {
      addOp.run(user, op.org, op.opId, op.kind, op.occurredAt,
        encrypt(Buffer.from(JSON.stringify({ args: op.args, label: op.label })), `${user}|queue|${op.opId}`));
    }
    db.exec("commit");
  } catch (err) {
    db.exec("rollback");
    throw err;
  }
  for (const t of touched) cache.delete(`${user}|${t}`);
}

/** File d'attente de ce compte, dans l'ordre où les actions ont été faites. */
export function pendingOps(user: string): QueuedOp[] {
  const rows = state().db.prepare("select seq, org, op_id, kind, occurred_at, data from queue where user_id = ? order by seq").all(user) as
    Array<{ seq: number; org: string; op_id: string; kind: string; occurred_at: string; data: Uint8Array }>;
  return rows.map((r) => {
    const body = JSON.parse(decrypt(r.data, `${user}|queue|${r.op_id}`).toString("utf8")) as { args: Record<string, unknown>; label: string };
    return { seq: r.seq, opId: r.op_id, user, org: r.org, kind: r.kind, occurredAt: r.occurred_at, args: body.args, label: body.label };
  });
}

export function pendingCount(user: string): number {
  return (state().db.prepare("select count(*) n from queue where user_id = ?").get(user) as { n: number }).n;
}

/** Retire une opération traitée, dans la même transaction que ce qu'elle a appris. */
export function dropQueuedOp(user: string, seq: number, meta: Record<string, string>): void {
  const { db } = state();
  db.exec("begin immediate");
  try {
    db.prepare("delete from queue where user_id = ? and seq = ?").run(user, seq);
    const setMeta = db.prepare("insert into meta (user_id, k, v) values (?, ?, ?) on conflict (user_id, k) do update set v = excluded.v");
    for (const [k, v] of Object.entries(meta)) setMeta.run(user, k, encrypt(Buffer.from(v), `${user}|meta|${k}`));
    db.exec("commit");
  } catch (err) {
    db.exec("rollback");
    throw err;
  }
}

// -----------------------------------------------------------------------------
// Poste : identifiant et séries de numéros (communs à tous les comptes du poste)
// -----------------------------------------------------------------------------
export interface DeviceInfo {
  series: string;
  memberPrefix: string;
  receiptPrefix: string;
}

export function deviceId(): string {
  return (state().db.prepare("select v from store_info where k = 'device_id'").get() as { v: string }).v;
}

export function saveDevice(org: string, device: DeviceInfo): void {
  state().db.prepare("insert into store_info (k, v) values (?, ?) on conflict (k) do update set v = excluded.v")
    .run(`device:${org}`, JSON.stringify(device));
}

export function getDevice(org: string): DeviceInfo | null {
  const row = state().db.prepare("select v from store_info where k = ?").get(`device:${org}`) as { v: string } | undefined;
  return row ? (JSON.parse(row.v) as DeviceInfo) : null;
}

/** Numéro suivant de ce poste. Jamais réutilisé, même si l'action est refusée ensuite. */
export function nextDeviceNumber(org: string, kind: "member" | "receipt"): number {
  const { db } = state();
  const k = `counter:${kind}:${org}`;
  db.prepare("insert into store_info (k, v) values (?, '1') on conflict (k) do update set v = cast(cast(v as integer) + 1 as text)").run(k);
  return Number((db.prepare("select v from store_info where k = ?").get(k) as { v: string }).v);
}

export function getMeta(user: string, k: string): string | null {
  const row = state().db.prepare("select v from meta where user_id = ? and k = ?").get(user, k) as { v: Uint8Array } | undefined;
  return row ? decrypt(row.v, `${user}|meta|${k}`).toString("utf8") : null;
}

// -----------------------------------------------------------------------------
// Comptes autorisés à se connecter hors ligne sur ce poste
// -----------------------------------------------------------------------------
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const MAX_ATTEMPTS = 5;
const LOCK_MS = 60_000;

const emailMac = (email: string) =>
  createHmac("sha256", state().key).update(`account|${email.trim().toLowerCase()}`).digest("hex");

/** Mémorise le mot de passe (empreinte scrypt) après une connexion EN LIGNE réussie. */
export function rememberAccount(email: string, password: string, userId: string): void {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32, SCRYPT);
  const mac = emailMac(email);
  state().db.prepare(`insert into accounts (email_mac, user_id, email, salt, hash) values (?, ?, ?, ?, ?)
    on conflict (email_mac) do update set user_id = excluded.user_id, email = excluded.email, salt = excluded.salt,
      hash = excluded.hash, failed = 0, locked_until = 0`)
    .run(mac, userId, encrypt(Buffer.from(email.trim().toLowerCase()), `account|${mac}`), salt, hash);
}

export type OfflineLogin = { ok: true; userId: string } | { ok: false; reason: "invalid" | "locked" };

/** Vérifie un mot de passe hors ligne, avec blocage temporaire après 5 échecs. */
export function verifyAccount(email: string, password: string): OfflineLogin {
  const { db } = state();
  const mac = emailMac(email);
  const row = db.prepare("select user_id, salt, hash, failed, locked_until from accounts where email_mac = ?").get(mac) as
    | { user_id: string; salt: Uint8Array; hash: Uint8Array; failed: number; locked_until: number }
    | undefined;
  // Même calcul sans compte : le temps de réponse ne révèle pas si le compte existe.
  const actual = scryptSync(password, row ? Buffer.from(row.salt) : randomBytes(16), 32, SCRYPT);
  if (!row) return { ok: false, reason: "invalid" };
  if (row.locked_until > Date.now()) return { ok: false, reason: "locked" };
  if (timingSafeEqual(actual, Buffer.from(row.hash))) {
    db.prepare("update accounts set failed = 0, locked_until = 0 where email_mac = ?").run(mac);
    return { ok: true, userId: row.user_id };
  }
  const failed = row.failed + 1;
  const locked = failed >= MAX_ATTEMPTS;
  db.prepare("update accounts set failed = ?, locked_until = ? where email_mac = ?")
    .run(locked ? 0 : failed, locked ? Date.now() + LOCK_MS : 0, mac);
  return { ok: false, reason: locked ? "locked" : "invalid" };
}

/** Retire du poste tout ce qui concerne ce compte (accès supprimé). */
export function forgetUser(user: string): void {
  const { db, cache } = state();
  for (const sql of ["delete from rows where user_id = ?", "delete from meta where user_id = ?", "delete from accounts where user_id = ?", "delete from queue where user_id = ?"]) {
    db.prepare(sql).run(user);
  }
  for (const key of cache.keys()) if (key.startsWith(`${user}|`)) cache.delete(key);
}

export function accountEmail(userId: string): string | null {
  const row = state().db.prepare("select email_mac, email from accounts where user_id = ?").get(userId) as
    | { email_mac: string; email: Uint8Array }
    | undefined;
  return row ? decrypt(row.email, `account|${row.email_mac}`).toString("utf8") : null;
}

// -----------------------------------------------------------------------------
// Session hors ligne : cookie signé, sans valeur en dehors de ce poste
// -----------------------------------------------------------------------------
const sign = (payload: string) => createHmac("sha256", state().key).update(`session|${payload}`).digest("base64url");

export function signSession(userId: string, expiresAt: number): string {
  const payload = `${userId}.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySession(cookie: string | undefined): string | null {
  if (!cookie) return null;
  const [userId, expires, signature] = cookie.split(".");
  if (!userId || !expires || !signature) return null;
  const expected = Buffer.from(sign(`${userId}.${expires}`));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return Number(expires) > Date.now() ? userId : null;
}
