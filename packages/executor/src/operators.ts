import {
  compare,
  encode,
  type Row,
  type Value,
} from "../../common/src/index.ts";
import type { Expr, Select } from "../../sql-parser/src/index.ts";
import { evaluate, matches } from "./expression.ts";
export function* scan(rows: Iterable<Row>): Generator<Row> {
  yield* rows;
}
export function* filter(
  rows: Iterable<Row>,
  predicate: Expr | undefined,
  params: Value[],
): Generator<Row> {
  for (const row of rows) if (matches(predicate, row, params)) yield row;
}
export function* project(
  rows: Iterable<Row>,
  fields: Select["fields"],
  params: Value[],
): Generator<Row> {
  for (const row of rows)
    yield fields === "*"
      ? { ...row }
      : Object.fromEntries(
          fields.map((f) => [f.alias, evaluate(f.expr, row, params)]),
        );
}
export function sort(
  rows: Iterable<Row>,
  order: NonNullable<Select["order"]>,
): Row[] {
  return [...rows].sort(
    (a, b) => compare(a[order.name]!, b[order.name]!) * (order.desc ? -1 : 1),
  );
}
export function* distinct(rows: Iterable<Row>): Generator<Row> {
  const seen = new Set<string>();
  for (const row of rows) {
    const key = encode(Object.values(row)).toString("hex");
    if (!seen.has(key)) {
      seen.add(key);
      yield row;
    }
  }
}
export function* limit(
  rows: Iterable<Row>,
  offset: number,
  count: number | undefined,
): Generator<Row> {
  let skipped = 0,
    emitted = 0;
  if (count === 0) return;
  for (const row of rows) {
    if (skipped++ < offset) continue;
    yield row;
    if (++emitted === count) return;
  }
}
