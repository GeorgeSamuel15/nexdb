import type { Expr, Select } from "../../sql-parser/src/index.ts";
import type { Table } from "../../catalog/src/index.ts";
export type Scan =
  | { kind: "SequentialScan" }
  | { kind: "IndexScan"; index: string; column: string; key: Expr };
export interface Plan {
  scan: Scan;
  filter?: Expr;
  sort?: { name: string; desc: boolean };
  projection: Select["fields"];
  offset: number;
  limit?: number;
  estimatedRows: number;
}
export function plan(s: Select, t: Table): Plan {
  let scan: Scan = { kind: "SequentialScan" };
  const w = s.where;
  if (w?.kind === "binary" && w.op === "=") {
    const col =
      w.left.kind === "column"
        ? w.left
        : w.right.kind === "column"
          ? w.right
          : null;
    const key = col === w.left ? w.right : w.left;
    if (col && (key.kind === "literal" || key.kind === "parameter")) {
      const index = t.indexes.find((i) => i.column === col.name);
      if (index)
        scan = {
          kind: "IndexScan",
          index: index.name,
          column: index.column,
          key,
        };
    }
  }
  return {
    scan,
    filter: s.where,
    sort: s.order,
    projection: s.fields,
    offset: s.offset,
    limit: s.limit,
    estimatedRows: scan.kind === "IndexScan" ? 1 : t.rows.length,
  };
}
export function explain(p: Plan) {
  return [
    p.scan.kind + (p.scan.kind === "IndexScan" ? ` ${p.scan.index}` : ""),
    p.filter ? "Filter" : null,
    p.sort ? "Sort" : null,
    "Projection",
    p.limit !== undefined || p.offset ? "Limit" : null,
  ]
    .filter(Boolean)
    .join(" -> ");
}
