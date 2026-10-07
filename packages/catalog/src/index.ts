import {
  assert,
  encode,
  decode,
  type Column,
  type Row,
  type Value,
  compare,
} from "../../common/src/index.ts";
import { BPlusTree } from "../../indexes/src/index.ts";
export interface Index {
  name: string;
  column: string;
  unique: boolean;
  tree: BPlusTree;
}
export interface Table {
  id: number;
  name: string;
  columns: Column[];
  rows: Row[];
  indexes: Index[];
}
export type Catalog = Table[];
export function coerce(c: Column, v: Value): Value {
  if (v === null) {
    assert(!c.notNull, "NOT_NULL", `${c.name} is required`);
    return null;
  }
  switch (c.type) {
    case "BIGINT":
      assert(
        typeof v === "bigint" ||
          (typeof v === "number" && Number.isSafeInteger(v)),
        "TYPE",
        `${c.name}: expected BIGINT`,
      );
      v = BigInt(v);
      assert(v >= -(1n << 63n) && v < 1n << 63n, "TYPE", "BIGINT out of range");
      break;
    case "INT":
      assert(
        typeof v === "number" &&
          Number.isInteger(v) &&
          v >= -2147483648 &&
          v <= 2147483647,
        "TYPE",
        `${c.name}: expected INT32`,
      );
      break;
    case "FLOAT":
      assert(
        typeof v === "number" && Number.isFinite(v),
        "TYPE",
        `${c.name}: expected FLOAT`,
      );
      break;
    case "BOOLEAN":
      assert(typeof v === "boolean", "TYPE", "Expected boolean");
      break;
    case "BLOB":
      assert(Buffer.isBuffer(v), "TYPE", "Expected Buffer");
      break;
    default:
      assert(typeof v === "string", "TYPE", `${c.name}: expected text`);
      if (c.type === "VARCHAR" && c.length !== undefined)
        assert([...v].length <= c.length, "TYPE", "VARCHAR exceeds length");
      if (c.type === "DATE")
        assert(
          /^\d{4}-\d{2}-\d{2}$/.test(v) &&
            !Number.isNaN(Date.parse(v)) &&
            new Date(v).toISOString().slice(0, 10) === v,
          "TYPE",
          "Expected valid ISO date",
        );
      if (c.type === "TIMESTAMP")
        assert(
          /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v) &&
            !Number.isNaN(Date.parse(v)),
          "TYPE",
          "Expected ISO timestamp with timezone",
        );
  }
  return v;
}
export function rebuild(t: Table) {
  for (const ix of t.indexes) ix.tree = new BPlusTree();
  t.rows.forEach((row, rid) => {
    for (const c of t.columns) row[c.name] = coerce(c, row[c.name] ?? null);
    for (const ix of t.indexes) {
      const key = row[ix.column]!;
      assert(
        !ix.unique || key === null || ix.tree.find(key).length === 0,
        "UNIQUE",
        `Duplicate ${ix.column}`,
      );
      ix.tree.insert(key, rid);
    }
  });
}
export function clone(c: Catalog): Catalog {
  return deserialize(serialize(c));
}
export function serialize(c: Catalog): Buffer[] {
  const records: Buffer[] = [encode(["catalog", 1, c.length])];
  for (const t of c) {
    records.push(encode(["table", t.id, t.name]));
    for (const col of t.columns)
      records.push(
        encode([
          "column",
          t.id,
          col.name,
          col.type,
          col.length ?? null,
          col.primary ?? false,
          col.unique ?? false,
          col.notNull ?? false,
          col.defaultValue ?? null,
        ]),
      );
    for (const row of t.rows)
      records.push(
        encode(["row", t.id, ...t.columns.map((col) => row[col.name]!)]),
      );
    for (const ix of t.indexes) {
      records.push(
        encode([
          "index",
          t.id,
          ix.name,
          ix.column,
          ix.unique,
          ix.tree.root,
          ix.tree.order,
        ]),
      );
      for (const n of ix.tree.nodes)
        records.push(
          encode([
            "node",
            t.id,
            ix.name,
            n.id,
            n.leaf,
            n.next,
            n.keys.length,
            ...n.keys,
            n.children.length,
            ...n.children,
            ...n.values.flatMap((v) => [v.length, ...v]),
          ]),
        );
    }
  }
  return records;
}
export function deserialize(records: Buffer[]): Catalog {
  const catalog: Catalog = [];
  const head = decode(records[0]!);
  assert(head[0] === "catalog" && head[1] === 1, "CORRUPT", "Catalog version");
  for (const b of records.slice(1)) {
    const a = decode(b),
      tag = a[0];
    if (tag === "table") {
      catalog.push({
        id: Number(a[1]),
        name: String(a[2]),
        columns: [],
        rows: [],
        indexes: [],
      });
      continue;
    }
    const t = catalog.find((t) => t.id === a[1]);
    assert(t, "CORRUPT", "Unknown table ID");
    if (tag === "column") {
      t.columns.push({
        name: String(a[2]),
        type: String(a[3]) as Column["type"],
        length: a[4] === null ? undefined : Number(a[4]),
        primary: !!a[5],
        unique: !!a[6],
        notNull: !!a[7],
        defaultValue: a[8]!,
      });
    } else if (tag === "row") {
      assert(a.length - 2 === t.columns.length, "CORRUPT", "Tuple arity");
      t.rows.push(
        Object.fromEntries(t.columns.map((c, i) => [c.name, a[i + 2]!])),
      );
    } else if (tag === "index") {
      const tree = new BPlusTree(Number(a[6]));
      tree.nodes = [];
      tree.root = Number(a[5]);
      t.indexes.push({
        name: String(a[2]),
        column: String(a[3]),
        unique: !!a[4],
        tree,
      });
    } else if (tag === "node") {
      const ix = t.indexes.find((i) => i.name === a[2]);
      assert(ix, "CORRUPT", "Unknown index");
      let p = 7;
      const keys = a.slice(p, p + Number(a[6]));
      p += keys.length;
      const childCount = Number(a[p++]);
      const children = a.slice(p, p + childCount).map(Number);
      p += childCount;
      const values: number[][] = [];
      while (p < a.length) {
        const count = Number(a[p++]);
        assert(
          count >= 0 && count <= a.length - p,
          "CORRUPT",
          "Index value count",
        );
        values.push(a.slice(p, p + count).map(Number));
        p += count;
      }
      ix.tree.nodes.push({
        id: Number(a[3]),
        leaf: !!a[4],
        next: a[5] === null ? null : Number(a[5]),
        keys,
        children,
        values,
      });
    } else assert(false, "CORRUPT", "Unknown catalog record");
  }
  assert(catalog.length === head[2], "CORRUPT", "Table count");
  return catalog;
}
export function same(a: Value, b: Value) {
  return compare(a, b) === 0;
}
