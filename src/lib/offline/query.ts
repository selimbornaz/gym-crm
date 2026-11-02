import "server-only";
import { RELATIONS, VIEW_TABLES, type Relation } from "./schema";
import { rowsOf, type Row } from "./store";
import { viewRows } from "./views";

/**
 * Lecture locale avec la même interface que le client Supabase : les pages ne
 * changent pas. Seules les formes réellement utilisées par l'application sont
 * prises en charge ; toute autre forme lève une erreur explicite plutôt que de
 * renvoyer silencieusement un résultat faux.
 */
export interface LocalError {
  code: string;
  message: string;
}

export const OFFLINE_READ_ONLY: LocalError = {
  code: "22023",
  message: "Mode hors ligne : consultation seulement. Cette action sera possible au retour d'Internet.",
};

// ---------------------------------------------------------------- comparaisons
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

function comparable(a: unknown, b: unknown): [number | string | boolean, number | string | boolean] {
  if (typeof a === "number" || typeof b === "number") return [Number(a), Number(b)];
  if (typeof a === "boolean" || typeof b === "boolean") return [a === true || a === "true", b === true || b === "true"];
  const sa = String(a);
  const sb = String(b);
  // Horodatages : même instant malgré des écritures différentes (Z, +00:00).
  if (TIMESTAMP.test(sa) || TIMESTAMP.test(sb)) {
    const ta = Date.parse(sa);
    const tb = Date.parse(sb);
    if (!Number.isNaN(ta) && !Number.isNaN(tb)) return [ta, tb];
  }
  return [sa, sb];
}

function compareValues(a: unknown, b: unknown): number {
  const [x, y] = comparable(a, b);
  if (typeof x === "string" && typeof y === "string") return x.localeCompare(y, "fr");
  return x < y ? -1 : x > y ? 1 : 0;
}

const ilikeRegex = (pattern: string) =>
  new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/[*%]/g, ".*").replace(/_/g, ".")}$`, "i");

type Predicate = (row: Row) => boolean;

function makePredicate(column: string, op: string, value: unknown): Predicate {
  const nullSafe = (test: (cell: unknown) => boolean): Predicate => (row) => {
    const cell = row[column];
    return cell !== null && cell !== undefined && test(cell);
  };
  switch (op) {
    case "eq": return nullSafe((c) => compareValues(c, value) === 0);
    case "neq": return nullSafe((c) => compareValues(c, value) !== 0);
    case "gt": return nullSafe((c) => compareValues(c, value) > 0);
    case "gte": return nullSafe((c) => compareValues(c, value) >= 0);
    case "lt": return nullSafe((c) => compareValues(c, value) < 0);
    case "lte": return nullSafe((c) => compareValues(c, value) <= 0);
    case "in": return nullSafe((c) => (value as unknown[]).some((v) => compareValues(c, v) === 0));
    case "ilike": {
      const regex = ilikeRegex(String(value));
      return nullSafe((c) => regex.test(String(c)));
    }
    case "is":
      if (value === null) return (row) => row[column] === null || row[column] === undefined;
      return (row) => row[column] === value;
    default:
      throw new Error(`Filtre hors ligne non pris en charge : ${op}`);
  }
}

/** `a.ilike.*x*,b.eq.1` : seules formes utilisées par la recherche de l'application. */
function parseOr(expression: string): Predicate {
  const parts = expression.split(",").map((part) => {
    const first = part.indexOf(".");
    const second = part.indexOf(".", first + 1);
    if (first < 0 || second < 0) throw new Error(`Filtre « or » hors ligne invalide : ${part}`);
    return makePredicate(part.slice(0, first), part.slice(first + 1, second), part.slice(second + 1));
  });
  return (row) => parts.some((p) => p(row));
}

// ---------------------------------------------------------------- select
interface Field {
  star?: true;
  column?: string;
  embed?: { alias: string; table: string; inner: boolean; fields: Field[] };
}

function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

export function parseSelect(select: string): Field[] {
  return splitTopLevel(select).map((part) => {
    if (part === "*") return { star: true };
    const open = part.indexOf("(");
    if (open < 0) {
      if (!/^[a-z_][a-z0-9_]*$/.test(part)) throw new Error(`Colonne hors ligne non prise en charge : ${part}`);
      return { column: part };
    }
    const head = part.slice(0, open);
    const [left, right] = head.includes(":") ? head.split(":") : [null, head];
    const [table, hint] = right!.split("!");
    return { embed: { alias: left ?? table!, table: table!, inner: hint === "inner", fields: parseSelect(part.slice(open + 1, -1)) } };
  });
}

const relationOf = (parent: string, child: string): Relation => {
  const relation = RELATIONS[parent]?.[child];
  if (!relation) throw new Error(`Relation hors ligne inconnue : ${parent} -> ${child}`);
  return relation;
};

export { relationOf };

function sourceRows(user: string, table: string): Row[] {
  return VIEW_TABLES.has(table) ? viewRows(user, table) : rowsOf(user, table);
}

/** Les lignes liées sont limitées à la salle de la ligne parente, comme en ligne. */
function linked(user: string, parent: Row, parentTable: string, childTable: string): Row[] {
  const relation = relationOf(parentTable, childTable);
  const value = parent[relation.local];
  if (value === null || value === undefined) return [];
  return rowsOf(user, childTable).filter((r) => r[relation.foreign] === value);
}

function project(user: string, table: string, row: Row, fields: Field[], embedFilters: Map<string, Predicate[]>, path = ""): Row {
  const out: Row = {};
  for (const field of fields) {
    if (field.star) Object.assign(out, row);
    else if (field.column) out[field.column] = row[field.column] ?? null;
    else if (field.embed) {
      const { alias, table: child, fields: inner } = field.embed;
      const relation = relationOf(table, child);
      const key = path ? `${path}.${alias}` : alias;
      const children = linked(user, row, table, child)
        .filter((c) => (embedFilters.get(key) ?? []).every((p) => p(c)))
        .map((c) => project(user, child, c, inner, embedFilters, key));
      out[alias] = relation.kind === "one" ? (children[0] ?? null) : children;
    }
  }
  return out;
}

// ---------------------------------------------------------------- requête
export interface LocalResult {
  data: unknown;
  error: LocalError | null;
  count: number | null;
  status: number;
  statusText: string;
}

const failure = (error: LocalError): LocalResult => ({ data: null, error, count: null, status: 400, statusText: "" });

export class LocalQuery implements PromiseLike<LocalResult> {
  private fields: Field[] = [{ star: true }];
  private predicates: Predicate[] = [];
  private embedFilters = new Map<string, Predicate[]>();
  private sorts: Array<{ column: string; ascending: boolean; nullsFirst: boolean }> = [];
  private from_ = 0;
  private to: number | null = null;
  private wantCount = false;
  private head = false;
  private cardinality: "many" | "single" | "maybe" = "many";
  private isWrite = false;

  constructor(private user: string, private table: string) {}

  select(columns = "*", options?: { count?: string; head?: boolean }) {
    // Après insert/update, `.select()` ne change rien : l'écriture est déjà refusée.
    if (!this.isWrite) this.fields = parseSelect(columns);
    this.wantCount = Boolean(options?.count);
    this.head = Boolean(options?.head);
    return this;
  }

  private addFilter(column: string, op: string, value: unknown) {
    const dot = column.indexOf(".");
    if (dot > 0) {
      const alias = column.slice(0, dot);
      const list = this.embedFilters.get(alias) ?? [];
      list.push(makePredicate(column.slice(dot + 1), op, value));
      this.embedFilters.set(alias, list);
    } else {
      this.predicates.push(makePredicate(column, op, value));
    }
    return this;
  }

  eq(column: string, value: unknown) { return this.addFilter(column, "eq", value); }
  neq(column: string, value: unknown) { return this.addFilter(column, "neq", value); }
  gt(column: string, value: unknown) { return this.addFilter(column, "gt", value); }
  gte(column: string, value: unknown) { return this.addFilter(column, "gte", value); }
  lt(column: string, value: unknown) { return this.addFilter(column, "lt", value); }
  lte(column: string, value: unknown) { return this.addFilter(column, "lte", value); }
  in(column: string, values: unknown[]) { return this.addFilter(column, "in", values); }
  is(column: string, value: unknown) { return this.addFilter(column, "is", value); }
  ilike(column: string, pattern: string) { return this.addFilter(column, "ilike", pattern); }

  not(column: string, op: string, value: unknown) {
    const inner = makePredicate(column, op, value);
    this.predicates.push((row) => !inner(row));
    return this;
  }

  or(expression: string) {
    this.predicates.push(parseOr(expression));
    return this;
  }

  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) {
    const ascending = options?.ascending ?? true;
    // Défaut PostgreSQL : NULL en dernier en ordre croissant, en premier sinon.
    this.sorts.push({ column, ascending, nullsFirst: options?.nullsFirst ?? !ascending });
    return this;
  }

  limit(count: number) {
    this.to = this.from_ + count - 1;
    return this;
  }

  range(from: number, to: number) {
    this.from_ = from;
    this.to = to;
    return this;
  }

  single() { this.cardinality = "single"; return this; }
  maybeSingle() { this.cardinality = "maybe"; return this; }

  insert() { this.isWrite = true; return this; }
  update() { this.isWrite = true; return this; }
  upsert() { this.isWrite = true; return this; }
  delete() { this.isWrite = true; return this; }

  private run(): LocalResult {
    if (this.isWrite) return failure(OFFLINE_READ_ONLY);

    let rows = sourceRows(this.user, this.table).filter((row) => this.predicates.every((p) => p(row)));

    // `table!inner(...)` : une ligne sans ligne liée correspondante est écartée.
    const inners = this.fields.flatMap((f) => (f.embed?.inner ? [f.embed] : []));
    for (const embed of inners) {
      const filters = this.embedFilters.get(embed.alias) ?? [];
      rows = rows.filter((row) => linked(this.user, row, this.table, embed.table).some((c) => filters.every((p) => p(c))));
    }

    const count = rows.length;
    if (this.sorts.length > 0) {
      rows = [...rows].sort((a, b) => {
        for (const { column, ascending, nullsFirst } of this.sorts) {
          const x = a[column];
          const y = b[column];
          const xNull = x === null || x === undefined;
          const yNull = y === null || y === undefined;
          if (xNull || yNull) {
            if (xNull && yNull) continue;
            return xNull === nullsFirst ? -1 : 1;
          }
          const diff = compareValues(x, y);
          if (diff !== 0) return ascending ? diff : -diff;
        }
        return 0;
      });
    }
    if (this.from_ > 0 || this.to !== null) rows = rows.slice(this.from_, this.to === null ? undefined : this.to + 1);

    if (this.head) return { data: null, error: null, count, status: 200, statusText: "OK" };
    const data = rows.map((row) => project(this.user, this.table, row, this.fields, this.embedFilters));

    if (this.cardinality !== "many") {
      if (data.length > 1 || (data.length === 0 && this.cardinality === "single")) {
        return { data: null, error: { code: "PGRST116", message: "Cannot coerce the result to a single JSON object" }, count: null, status: 406, statusText: "" };
      }
      return { data: data[0] ?? null, error: null, count: this.wantCount ? count : null, status: 200, statusText: "OK" };
    }
    return { data, error: null, count: this.wantCount ? count : null, status: 200, statusText: "OK" };
  }

  then<A = LocalResult, B = never>(
    onFulfilled?: ((value: LocalResult) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    return new Promise<LocalResult>((resolve) => resolve(this.run())).then(onFulfilled, onRejected);
  }
}
