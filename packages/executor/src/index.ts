import { encodeRecords } from "../../storage/src/records.ts";
import * as operators from "./operators.ts";
import { plan, explain } from "../../planner/src/index.ts";
import {
  assert,
  NexError,
  type Row,
  type Value,
} from "../../common/src/index.ts";
import {
  parse,
  type Statement,
  type Select,
  type Expr,
} from "../../sql-parser/src/index.ts";
import { BPlusTree } from "../../indexes/src/index.ts";
import { evaluate, matches } from "./expression.ts";
import {
  type Catalog,
  type Table,
  clone,
  rebuild,
  serialize,
  deserialize,
  coerce,
} from "../../catalog/src/index.ts";
import { Persistence } from "./persistence.ts";
export interface Result {
  rows: Row[];
  affected: number;
  plan?: string;
  timeMs: number;
}
export class Database {
  private queue: Promise<unknown> = Promise.resolve();
  private catalog: Catalog = [];
  private working: Catalog | null = null;
  private closed = false;
  readonly metrics = {
    queries_total: 0,
    queries_failed: 0,
    transactions_total: 0,
    transactions_aborted: 0,
  };
  private constructor(private persistence: Persistence) {}
  static async open(path: string) {
    const p = await Persistence.open(path);
    try {
      const db = new Database(p),
        records = await p.load();
      db.catalog = records.length ? deserialize(records) : [];
      return db;
    } catch (e) {
      await p.close();
      throw e;
    }
  }
  get bufferStats() {
    return { ...this.persistence.bufferStats };
  }
  schema() {
    return clone(this.working ?? this.catalog);
  }
  private table(c: Catalog, name: string) {
    const t = c.find((t) => t.name === name);
    assert(t, "TABLE", `Unknown table ${name}`);
    return t;
  }
  private validate(e: Expr | undefined, t: Table) {
    if (!e) return;
    if (e.kind === "column")
      assert(
        t.columns.some((c) => c.name === e.name),
        "COLUMN",
        `Unknown column ${e.name}`,
      );
    if (e.kind === "unary") this.validate(e.value, t);
    if (e.kind === "binary") {
      this.validate(e.left, t);
      this.validate(e.right, t);
    }
  }
  private source(s: Select, t: Table, p: Value[]) {
    const physical = plan(s, t),
      scan = physical.scan;
    if (scan.kind === "IndexScan") {
      const ix = t.indexes.find((i) => i.name === scan.index)!;
      const raw = evaluate(scan.key, {}, p);
      const value =
        raw === null
          ? null
          : coerce(
              t.columns.find((c) => c.name === ix.column)!,
              raw,
            );
      return {
        rows: ix.tree.find(value).map((i) => t.rows[i]!),
        plan: explain(physical),
      };
    }
    return { rows: t.rows, plan: explain(physical) };
  }
  private select(
    s: Select,
    t: Table,
    p: Value[],
  ): { rows: Row[]; plan: string } {
    this.validate(s.where, t);
    if (s.fields !== "*")
      for (const field of s.fields) this.validate(field.expr, t);
    if (s.order)
      assert(
        t.columns.some((c) => c.name === s.order!.name),
        "COLUMN",
        "Unknown ORDER BY column",
      );
    const source = this.source(s, t, p);
    if (s.explain) return { rows: [{ plan: source.plan }], plan: source.plan };
    let rows: Iterable<Row> = operators.filter(
      operators.scan(source.rows),
      s.where,
      p,
    );
    if (s.order) rows = operators.sort(rows, s.order);
    rows = operators.project(rows, s.fields, p);
    if (s.distinct) rows = operators.distinct(rows);
    return {
      rows: [...operators.limit(rows, s.offset, s.limit)],
      plan: source.plan,
    };
  }

  private mutate(s: Statement, c: Catalog, p: Value[]): number {
    if (s.kind === "create") {
      assert(!c.some((t) => t.name === s.table), "TABLE", "Table exists");
      assert(
        new Set(s.columns.map((c) => c.name)).size === s.columns.length,
        "COLUMN",
        "Duplicate columns",
      );
      assert(
        s.columns.filter((c) => c.primary).length <= 1,
        "CONSTRAINT",
        "Composite primary keys not supported",
      );
      const t: Table = {
        id: Math.max(0, ...c.map((t) => t.id)) + 1,
        name: s.table,
        columns: s.columns,
        rows: [],
        indexes: [],
      };
      for (const col of t.columns) {
        if (col.defaultValue !== undefined) coerce(col, col.defaultValue);
        if (col.unique)
          t.indexes.push({
            name: `${t.name}_${col.name}_key`,
            column: col.name,
            unique: true,
            tree: new BPlusTree(),
          });
      }
      c.push(t);
      return 0;
    }
    if (s.kind === "drop") {
      const t = this.table(c, s.table);
      c.splice(c.indexOf(t), 1);
      return 0;
    }
    if (s.kind === "dropIndex") {
      const t = c.find((t) => t.indexes.some((i) => i.name === s.name));
      assert(t, "INDEX", "Unknown index");
      const ix = t.indexes.find((i) => i.name === s.name)!;
      assert(
        !t.columns.some(
          (col) =>
            col.unique &&
            col.name === ix.column &&
            ix.name === `${t.name}_${col.name}_key`,
        ),
        "CONSTRAINT",
        "Cannot drop a constraint index",
      );
      t.indexes.splice(t.indexes.indexOf(ix), 1);
      return 0;
    }
    assert("table" in s, "STATEMENT", "Expected mutation");
    const t = this.table(c, s.table);
    let affected = 0;
    if (s.kind === "index") {
      assert(
        !c.some((t) => t.indexes.some((i) => i.name === s.name)),
        "INDEX",
        "Index exists",
      );
      assert(
        t.columns.some((c) => c.name === s.column),
        "COLUMN",
        "Unknown index column",
      );
      t.indexes.push({
        name: s.name,
        column: s.column,
        unique: s.unique,
        tree: new BPlusTree(),
      });
    } else if (s.kind === "insert") {
      const names = s.columns ?? t.columns.map((c) => c.name);
      assert(
        new Set(names).size === names.length &&
          names.every((n) => t.columns.some((c) => c.name === n)),
        "COLUMN",
        "Invalid insert columns",
      );
      for (const values of s.rows) {
        assert(
          values.length === names.length,
          "ARITY",
          "Column/value count mismatch",
        );
        const row: Row = Object.fromEntries(
          t.columns.map((c) => [c.name, c.defaultValue ?? null]),
        );
        values.forEach((v, i) => (row[names[i]!] = evaluate(v, {}, p)));
        t.rows.push(row);
        affected++;
      }
    } else if (s.kind === "update") {
      this.validate(s.where, t);
      assert(
        new Set(s.assignments.map((a) => a.name)).size === s.assignments.length,
        "COLUMN",
        "Duplicate assignment",
      );
      for (const a of s.assignments) {
        assert(
          t.columns.some((c) => c.name === a.name),
          "COLUMN",
          "Unknown assignment column",
        );
        this.validate(a.expr, t);
      }
      t.rows = t.rows.map((row) => {
        if (!matches(s.where, row, p)) return row;
        const updated = { ...row };
        for (const a of s.assignments)
          updated[a.name] = evaluate(a.expr, row, p);
        affected++;
        return updated;
      });
    } else if (s.kind === "delete") {
      this.validate(s.where, t);
      t.rows = t.rows.filter((row) => {
        if (matches(s.where, row, p)) {
          affected++;
          return false;
        }
        return true;
      });
    } else throw new NexError("STATEMENT", "Not a mutation");
    rebuild(t);
    return affected;
  }
  query(sql: string, params: Value[] = []): Promise<Result> {
    const next = this.queue.then(() => this.execute(sql, params));
    this.queue = next.catch(() => undefined);
    return next;
  }
  private async execute(sql: string, params: Value[] = []): Promise<Result> {
    assert(!this.closed, "CLOSED", "Database is closed");
    const start = performance.now();
    this.metrics.queries_total++;
    try {
      const s = parse(sql);
      let rows: Row[] = [],
        affected = 0,
        plan: string | undefined;
      if (s.kind === "begin") {
        assert(!this.working, "TRANSACTION", "Transaction already active");
        this.working = clone(this.catalog);
        this.metrics.transactions_total++;
      } else if (s.kind === "rollback") {
        assert(this.working, "TRANSACTION", "No transaction");
        this.working = null;
        this.metrics.transactions_aborted++;
      } else if (s.kind === "commit") {
        assert(this.working, "TRANSACTION", "No transaction");
        await this.persist(this.working);
        this.working = null;
      } else if (s.kind === "select") {
        const result = this.select(
          s,
          this.table(this.working ?? this.catalog, s.table),
          params,
        );
        rows = result.rows;
        plan = result.plan;
      } else {
        const candidate = clone(this.working ?? this.catalog);
        affected = this.mutate(s, candidate, params);
        if (this.working) this.working = candidate;
        else await this.persist(candidate);
      }
      return { rows, affected, plan, timeMs: performance.now() - start };
    } catch (e) {
      this.metrics.queries_failed++;
      throw e;
    }
  }
  private async persist(c: Catalog) {
    const records = serialize(c);
    // Validate the complete image before entering the potentially fatal I/O path.
    const image = encodeRecords(records);
    try {
      await this.persistence.commit(image);
      this.catalog = c;
    } catch (e) {
      this.closed = true;
      throw e;
    }
  }
  async close() {
    await this.queue;
    this.working = null;
    await this.persistence.close();
    this.closed = true;
  }
  async checkpoint() {
    assert(
      !this.working,
      "TRANSACTION",
      "Checkpoint requires no active transaction",
    );
    await this.persistence.checkpoint();
  }
}
