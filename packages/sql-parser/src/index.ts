import {
  type Column,
  type Value,
  type DataType,
  NexError,
} from "../../common/src/index.ts";
import { tokenize, type Token } from "./lexer.ts";
export { tokenize } from "./lexer.ts";
export type Expr =
  | { kind: "literal"; value: Value }
  | { kind: "column"; name: string }
  | { kind: "parameter"; index: number }
  | { kind: "unary"; op: string; value: Expr }
  | { kind: "binary"; op: string; left: Expr; right: Expr };
export interface Select {
  kind: "select";
  table: string;
  fields: { expr: Expr; alias: string }[] | "*";
  where?: Expr;
  order?: { name: string; desc: boolean };
  limit?: number;
  offset: number;
  distinct: boolean;
  explain?: boolean;
}
export type Statement =
  | Select
  | { kind: "create"; table: string; columns: Column[] }
  | { kind: "drop"; table: string }
  | { kind: "insert"; table: string; columns?: string[]; rows: Expr[][] }
  | {
      kind: "update";
      table: string;
      assignments: { name: string; expr: Expr }[];
      where?: Expr;
    }
  | { kind: "delete"; table: string; where?: Expr }
  | {
      kind: "index";
      table: string;
      name: string;
      column: string;
      unique: boolean;
    }
  | { kind: "dropIndex"; name: string }
  | { kind: "begin" | "commit" | "rollback" };
const precedence: Record<string, number> = {
  OR: 1,
  AND: 2,
  "=": 3,
  "!=": 3,
  "<>": 3,
  "<": 3,
  ">": 3,
  "<=": 3,
  ">=": 3,
  IS: 3,
  "+": 4,
  "-": 4,
  "*": 5,
  "/": 5,
};
class Parser {
  private at = 0;
  private parameter = 0;
  private depth = 0;
  constructor(private tokens: Token[]) {}
  get token() {
    return this.tokens[this.at]!;
  }
  is(s: string) {
    return this.token.kind !== "string" && this.token.text.toUpperCase() === s;
  }
  take(s: string) {
    if (this.is(s)) {
      this.at++;
      return true;
    }
    return false;
  }
  expect(s: string) {
    if (!this.take(s)) this.fail(s);
  }
  fail(expected: string): never {
    throw new NexError(
      "SYNTAX",
      `At ${this.token.line}:${this.token.column}: token ${this.token.text}; expected ${expected}`,
    );
  }
  name() {
    if (this.token.kind !== "word") this.fail("identifier");
    return this.tokens[this.at++]!.text.toLowerCase();
  }
  integer() {
    if (this.token.kind !== "number" || !/^\d+$/.test(this.token.text))
      this.fail("nonnegative integer");
    const n = Number(this.tokens[this.at++]!.text);
    if (!Number.isSafeInteger(n)) this.fail("safe integer");
    return n;
  }
  expr(min = 0): Expr {
    if (++this.depth > 100) this.fail("expression depth <= 100");
    let left: Expr;
    if (this.take("(")) {
      left = this.expr();
      this.expect(")");
    } else if (this.take("NOT"))
      left = { kind: "unary", op: "NOT", value: this.expr(3) };
    else if (this.take("-"))
      left = { kind: "unary", op: "-", value: this.expr(6) };
    else if (this.take("?"))
      left = { kind: "parameter", index: this.parameter++ };
    else if (this.take("NULL")) left = { kind: "literal", value: null };
    else if (this.take("TRUE")) left = { kind: "literal", value: true };
    else if (this.take("FALSE")) left = { kind: "literal", value: false };
    else if (this.token.kind === "string")
      left = { kind: "literal", value: this.tokens[this.at++]!.text };
    else if (this.token.kind === "number") {
      const s = this.tokens[this.at++]!.text;
      left = {
        kind: "literal",
        value:
          !s.includes(".") && !Number.isSafeInteger(Number(s))
            ? BigInt(s)
            : Number(s),
      };
    } else left = { kind: "column", name: this.name() };
    while (true) {
      const op = this.token.text.toUpperCase(),
        p = precedence[op];
      if (p === undefined || p < min) break;
      this.at++;
      if (op === "IS") {
        const not = this.take("NOT");
        this.expect("NULL");
        left = {
          kind: "unary",
          op: not ? "IS NOT NULL" : "IS NULL",
          value: left,
        };
      } else left = { kind: "binary", op, left, right: this.expr(p + 1) };
    }
    this.depth--;
    return left;
  }
  list<T>(fn: () => T): T[] {
    const list = [fn()];
    while (this.take(",")) list.push(fn());
    return list;
  }
  parse(): Statement {
    const explain = this.take("EXPLAIN");
    let s: Statement;
    if (this.take("CREATE")) {
      const unique = this.take("UNIQUE");
      if (this.take("INDEX")) {
        const name = this.name();
        this.expect("ON");
        const table = this.name();
        this.expect("(");
        const column = this.name();
        this.expect(")");
        s = { kind: "index", name, table, column, unique };
      } else {
        if (unique) this.fail("INDEX");
        this.expect("TABLE");
        const table = this.name();
        this.expect("(");
        const columns = this.list(() => {
          const name = this.name(),
            type = this.name().toUpperCase() as DataType;
          if (
            ![
              "INT",
              "BIGINT",
              "FLOAT",
              "BOOLEAN",
              "TEXT",
              "VARCHAR",
              "DATE",
              "TIMESTAMP",
              "BLOB",
            ].includes(type)
          )
            this.fail("supported type");
          const c: Column = { name, type };
          if (this.take("(")) {
            c.length = this.integer();
            this.expect(")");
          }
          while (true) {
            if (this.take("PRIMARY")) {
              this.expect("KEY");
              c.primary = c.unique = c.notNull = true;
            } else if (this.take("UNIQUE")) c.unique = true;
            else if (this.take("NOT")) {
              this.expect("NULL");
              c.notNull = true;
            } else if (this.take("DEFAULT")) {
              const e = this.expr(6);
              if (e.kind === "literal") c.defaultValue = e.value;
              else if (
                e.kind === "unary" &&
                e.op === "-" &&
                e.value.kind === "literal" &&
                typeof e.value.value === "number"
              )
                c.defaultValue = -e.value.value;
              else this.fail("literal default");
            } else break;
          }
          return c;
        });
        this.expect(")");
        s = { kind: "create", table, columns };
      }
    } else if (this.take("DROP")) {
      if (this.take("INDEX")) s = { kind: "dropIndex", name: this.name() };
      else {
        this.expect("TABLE");
        s = { kind: "drop", table: this.name() };
      }
    } else if (this.take("INSERT")) {
      this.expect("INTO");
      const table = this.name();
      let columns: string[] | undefined;
      if (this.take("(")) {
        columns = this.list(() => this.name());
        this.expect(")");
      }
      this.expect("VALUES");
      const rows = this.list(() => {
        this.expect("(");
        const values = this.list(() => this.expr());
        this.expect(")");
        return values;
      });
      s = { kind: "insert", table, columns, rows };
    } else if (this.take("SELECT")) {
      const distinct = this.take("DISTINCT");
      const fields = this.take("*")
        ? "*"
        : this.list(() => {
            const expr = this.expr();
            return {
              expr,
              alias: this.take("AS")
                ? this.name()
                : expr.kind === "column"
                  ? expr.name
                  : "expression",
            };
          });
      this.expect("FROM");
      const table = this.name();
      const where = this.take("WHERE") ? this.expr() : undefined;
      const select: Select = {
        kind: "select",
        table,
        fields,
        where,
        distinct,
        offset: 0,
        explain,
      };
      if (this.take("ORDER")) {
        this.expect("BY");
        const name = this.name(),
          desc = this.take("DESC");
        if (!desc) this.take("ASC");
        select.order = { name, desc };
      }
      if (this.take("LIMIT")) select.limit = this.integer();
      if (this.take("OFFSET")) select.offset = this.integer();
      s = select;
    } else if (this.take("UPDATE")) {
      const table = this.name();
      this.expect("SET");
      const assignments = this.list(() => {
        const name = this.name();
        this.expect("=");
        return { name, expr: this.expr() };
      });
      s = {
        kind: "update",
        table,
        assignments,
        where: this.take("WHERE") ? this.expr() : undefined,
      };
    } else if (this.take("DELETE")) {
      this.expect("FROM");
      const table = this.name();
      s = {
        kind: "delete",
        table,
        where: this.take("WHERE") ? this.expr() : undefined,
      };
    } else if (this.take("BEGIN")) s = { kind: "begin" };
    else if (this.take("COMMIT")) s = { kind: "commit" };
    else if (this.take("ROLLBACK")) s = { kind: "rollback" };
    else this.fail("SQL statement");
    if (explain && s.kind !== "select") this.fail("SELECT after EXPLAIN");
    this.take(";");
    if (this.token.kind !== "eof") this.fail("end of statement");
    return s;
  }
}
export function parse(sql: string): Statement {
  if (sql.length > 1_000_000) throw new NexError("LIMIT", "SQL too long");
  return new Parser(tokenize(sql)).parse();
}
