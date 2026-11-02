import "server-only";
import { SYNC_TABLES, tableByName } from "./schema";
import { applyBatch, getMeta, type Row, type WriteBatch } from "./store";

/**
 * Téléchargement vers le poste. Toutes les lectures passent par la session de
 * l'utilisateur, donc par la RLS : une ligne qui n'est plus visible (supprimée,
 * ou membre réaffecté à un autre coach) est retirée du poste.
 * Le curseur avance dans la même transaction que les données.
 */
interface RemoteResult<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
}

/** Sous-ensemble du client Supabase utilisé ici. */
export interface RemoteClient {
  from(table: string): {
    select(columns: string): RemoteFilter;
  };
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RemoteResult<unknown>>;
}

interface RemoteFilter extends PromiseLike<RemoteResult<Row[]>> {
  eq(column: string, value: unknown): RemoteFilter;
  in(column: string, values: unknown[]): RemoteFilter;
  order(column: string): RemoteFilter;
  range(from: number, to: number): RemoteFilter;
}

interface ChangesPage {
  head: number;
  next_since: number;
  changes: Array<{ seq: number; table: string; id: string; op: string }>;
  has_more: boolean;
  resync_required: boolean;
}

export interface SyncSummary {
  organizations: number;
  fullCopies: number;
  upserted: number;
  removed: number;
  at: string;
}

const PAGE = 1000;
const ID_CHUNK = 150;

function must<T>(result: RemoteResult<T>, what: string): T {
  if (result.error) throw new Error(`${what} : ${result.error.message}`);
  return result.data as T;
}

const cursorKey = (org: string) => `cursor:${org}`;
const rowOrg = (table: string, row: Row, org: string) => {
  const def = tableByName.get(table)!;
  return def.org ? String(row[def.org]) : org;
};

async function fetchAll(client: RemoteClient, table: string, org: string): Promise<Row[]> {
  const def = tableByName.get(table)!;
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = client.from(table).select("*");
    if (def.org) query = query.eq(def.org, org);
    const page = must(await query.order(def.pk).range(from, from + PAGE - 1), `Lecture de ${table}`);
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

async function fullCopy(client: RemoteClient, user: string, org: string): Promise<number> {
  // Numéro pris AVANT la copie : un changement concurrent sera simplement relu.
  const start = must(await client.rpc("sync_changes", { p_org: org, p_since: null }), "Journal") as ChangesPage;
  const replace: NonNullable<WriteBatch["replace"]> = [];
  let total = 0;
  for (const def of SYNC_TABLES) {
    // Les profils sont communs : complétés par les changements et la copie de chaque salle.
    const rows = await fetchAll(client, def.name, org);
    total += rows.length;
    replace.push({
      table: def.name,
      org: def.org ? org : "",
      rows: rows.map((row) => ({ id: String(row[def.pk]), org: def.org ? String(row[def.org]) : "", row })),
    });
  }
  applyBatch(user, { replace, meta: { [cursorKey(org)]: String(start.head) } });
  return total;
}

async function applyChanges(client: RemoteClient, user: string, org: string, since: number) {
  let cursor = since;
  let upserted = 0;
  let removed = 0;
  for (;;) {
    const page = must(await client.rpc("sync_changes", { p_org: org, p_since: cursor, p_limit: 500 }), "Journal") as ChangesPage;
    if (page.resync_required) return { resync: true, upserted, removed };
    if (page.changes.length === 0) {
      if (page.next_since !== cursor) applyBatch(user, { meta: { [cursorKey(org)]: String(page.next_since) } });
      return { resync: false, upserted, removed };
    }

    const byTable = new Map<string, Set<string>>();
    for (const c of page.changes) {
      if (!tableByName.has(c.table)) continue;
      const ids = byTable.get(c.table) ?? new Set<string>();
      ids.add(c.id);
      byTable.set(c.table, ids);
    }

    const batch: Required<Pick<WriteBatch, "upsert" | "remove">> & { meta: Record<string, string> } = {
      upsert: [], remove: [], meta: { [cursorKey(org)]: String(page.next_since) },
    };
    for (const [table, idSet] of byTable) {
      const def = tableByName.get(table)!;
      const ids = [...idSet];
      for (let i = 0; i < ids.length; i += ID_CHUNK) {
        const chunk = ids.slice(i, i + ID_CHUNK);
        const rows = must(await client.from(table).select("*").in(def.pk, chunk), `Lecture de ${table}`);
        const found = new Set(rows.map((r) => String(r[def.pk])));
        for (const row of rows) batch.upsert.push({ table, id: String(row[def.pk]), org: def.org ? rowOrg(table, row, org) : "", row });
        for (const id of chunk) if (!found.has(id)) batch.remove.push({ table, id });
      }
    }
    applyBatch(user, batch);
    upserted += batch.upsert.length;
    removed += batch.remove.length;
    cursor = page.next_since;
    if (!page.has_more) return { resync: false, upserted, removed };
  }
}

/** Synchronise les salles de cet utilisateur vers le poste. */
export async function pullAll(client: RemoteClient, user: string, orgs: string[]): Promise<SyncSummary> {
  const summary: SyncSummary = { organizations: orgs.length, fullCopies: 0, upserted: 0, removed: 0, at: new Date().toISOString() };
  for (const org of orgs) {
    const perms = must(await client.rpc("my_permissions", { org }), "Permissions") as string[];
    const saved = getMeta(user, cursorKey(org));
    let needFull = saved === null;
    if (saved !== null) {
      const result = await applyChanges(client, user, org, Number(saved));
      needFull = result.resync;
      summary.upserted += result.upserted;
      summary.removed += result.removed;
    }
    if (needFull) {
      summary.upserted += await fullCopy(client, user, org);
      summary.fullCopies++;
    }
    applyBatch(user, { meta: { [`permissions:${org}`]: JSON.stringify(perms) } });
  }
  applyBatch(user, { meta: { last_sync: summary.at } });
  return summary;
}
