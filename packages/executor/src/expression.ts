import {
  assert,
  compare,
  type Row,
  type Value,
  NexError,
} from "../../common/src/index.ts";
import type { Expr } from "../../sql-parser/src/index.ts";
export function evaluate(e: Expr, row: Row, params: Value[]): Value {
  if (e.kind === "literal") return e.value;
  if (e.kind === "parameter") {
    assert(e.index < params.length, "PARAMETER", "Missing parameter");
    return params[e.index]!;
  }
  if (e.kind === "column") {
    assert(Object.hasOwn(row, e.name), "COLUMN", `Unknown column ${e.name}`);
    return row[e.name]!;
  }
  if (e.kind === "unary") {
    const v = evaluate(e.value, row, params);
    if (e.op === "IS NULL") return v === null;
    if (e.op === "IS NOT NULL") return v !== null;
    if (v === null) return null;
    if (e.op === "NOT") {
      assert(typeof v === "boolean", "TYPE", "NOT requires boolean");
      return !v;
    }
    assert(
      typeof v === "number" || typeof v === "bigint",
      "TYPE",
      "Unary minus requires number",
    );
    return -v;
  }
  const a = evaluate(e.left, row, params),
    b = evaluate(e.right, row, params);
  if (e.op === "AND" || e.op === "OR") {
    assert(
      (a === null || typeof a === "boolean") &&
        (b === null || typeof b === "boolean"),
      "TYPE",
      "Logical expression requires booleans",
    );
    return e.op === "AND"
      ? a === false || b === false
        ? false
        : a === null || b === null
          ? null
          : true
      : a === true || b === true
        ? true
        : a === null || b === null
          ? null
          : false;
  }
  if (a === null || b === null) return null;
  const cmp = compare(a, b);
  switch (e.op) {
    case "=":
      return cmp === 0;
    case "!=":
    case "<>":
      return cmp !== 0;
    case "<":
      return cmp < 0;
    case ">":
      return cmp > 0;
    case "<=":
      return cmp <= 0;
    case ">=":
      return cmp >= 0;
  }
  assert(
    (typeof a === "number" || typeof a === "bigint") &&
      (typeof b === "number" || typeof b === "bigint"),
    "TYPE",
    "Arithmetic requires numbers",
  );
  if (typeof a === "bigint" || typeof b === "bigint") {
    assert(
      (typeof a === "bigint" || Number.isSafeInteger(a)) &&
        (typeof b === "bigint" || Number.isSafeInteger(b)),
      "TYPE",
      "Cannot mix BIGINT and fractional number",
    );
    const x = BigInt(a),
      y = BigInt(b);
    switch (e.op) {
      case "+":
        return x + y;
      case "-":
        return x - y;
      case "*":
        return x * y;
      case "/":
        assert(y !== 0n, "DIV_ZERO", "Division by zero");
        return x / y;
    }
  } else
    switch (e.op) {
      case "+":
        return a + b;
      case "-":
        return a - b;
      case "*":
        return a * b;
      case "/":
        assert(b !== 0, "DIV_ZERO", "Division by zero");
        return a / b;
    }
  throw new NexError("OPERATOR", `Unknown operator ${e.op}`);
}
export function matches(e: Expr | undefined, row: Row, p: Value[]): boolean {
  if (!e) return true;
  const v = evaluate(e, row, p);
  assert(
    v === null || typeof v === "boolean",
    "TYPE",
    "WHERE requires boolean",
  );
  return v === true;
}
