import { NexError } from "../../common/src/index.ts";
export interface Token {
  kind: "word" | "string" | "number" | "symbol" | "eof";
  text: string;
  line: number;
  column: number;
}
export function tokenize(sql: string): Token[] {
  const out: Token[] = [];
  let i = 0,
    line = 1,
    column = 1;
  function advance() {
    const c = sql[i++]!;
    if (c === "\n") {
      line++;
      column = 1;
    } else column++;
    return c;
  }
  while (i < sql.length) {
    const c = sql[i]!;
    if (/\s/.test(c)) {
      advance();
      continue;
    }
    if (sql.slice(i, i + 2) === "--") {
      while (i < sql.length && advance() !== "\n") {}
      continue;
    }
    const start = { line, column };
    if (c === "'") {
      advance();
      let text = "",
        closed = false;
      while (i < sql.length) {
        const ch = advance();
        if (ch === "'") {
          if (sql[i] === "'") {
            advance();
            text += "'";
          } else {
            closed = true;
            break;
          }
        } else text += ch;
      }
      if (!closed)
        throw new NexError(
          "SYNTAX",
          `Unterminated string at ${start.line}:${start.column}`,
        );
      out.push({ kind: "string", text, ...start });
      continue;
    }
    const match = /^[A-Za-z_][A-Za-z_0-9]*|^\d+(?:\.\d+)?/.exec(sql.slice(i));
    if (match) {
      const text = match[0];
      for (let j = 0; j < text.length; j++) advance();
      out.push({ kind: /^\d/.test(text) ? "number" : "word", text, ...start });
      continue;
    }
    const two = sql.slice(i, i + 2);
    const text = ["<=", ">=", "!=", "<>"].includes(two)
      ? advance() + advance()
      : advance();
    if (
      ![
        "(",
        ")",
        ",",
        ";",
        "*",
        "+",
        "-",
        "/",
        "=",
        "<",
        ">",
        "<=",
        ">=",
        "!=",
        "<>",
        "?",
        ".",
      ].includes(text)
    )
      throw new NexError(
        "SYNTAX",
        `Unexpected token ${text} at ${start.line}:${start.column}`,
      );
    out.push({ kind: "symbol", text, ...start });
  }
  out.push({ kind: "eof", text: "<EOF>", line, column });
  return out;
}
