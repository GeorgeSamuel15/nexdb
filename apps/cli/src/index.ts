import { createInterface } from "node:readline";
import { resolve, join } from "node:path";
import { Database } from "../../../packages/executor/src/index.ts";
const args = process.argv.slice(2),
  init = args[0] === "init",
  directory = args[init ? 1 : 0] ?? "./data";
const db = await Database.open(join(resolve(directory), "main.ndb"));
if (init) {
  await db.close();
  console.log(`Initialized ${resolve(directory)}`);
} else {
  console.log("NexDB 0.1.0 — .help for commands");
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY,
    historySize: 1000,
  });
  let ended = false;
  rl.on("close", () => {
    ended = true;
  });
  let sql = "";
  rl.setPrompt("nexdb> ");
  if (!ended && process.stdin.isTTY) rl.prompt();
  try {
    for await (const line of rl) {
      if (line.trim() === ".exit") break;
      try {
        if (line.startsWith(".")) {
          switch (line.trim()) {
            case ".help":
              console.log(
                ".tables .schema .indexes .stats .checkpoint .exit\nEnd SQL with a semicolon. One statement per submission.",
              );
              break;
            case ".tables":
              console.table(
                db
                  .schema()
                  .map((t) => ({ table: t.name, rows: t.rows.length })),
              );
              break;
            case ".schema":
              console.dir(
                db.schema().map((t) => ({ table: t.name, columns: t.columns })),
                { depth: null },
              );
              break;
            case ".indexes":
              console.table(
                db.schema().flatMap((t) =>
                  t.indexes.map((i) => ({
                    table: t.name,
                    name: i.name,
                    column: i.column,
                    unique: i.unique,
                  })),
                ),
              );
              break;
            case ".stats":
              console.table(db.metrics);
              break;
            case ".checkpoint":
              await db.checkpoint();
              console.log("Checkpoint complete");
              break;
            default:
              console.log("Unknown command");
          }
        } else {
          sql += line + "\n";
          if (sql.trimEnd().endsWith(";")) {
            const text = sql;
            sql = "";
            const result = await db.query(text);
            console.table(result.rows);
            console.log(
              `${result.rows.length} rows returned; ${result.affected} affected (${result.timeMs.toFixed(2)} ms)`,
            );
          }
        }
      } catch (e) {
        sql = "";
        console.error(e instanceof Error ? e.message : e);
      }
      rl.setPrompt(sql ? "   ...> " : "nexdb> ");
      if (!ended && process.stdin.isTTY) rl.prompt();
    }
  } finally {
    rl.close();
    await db.close();
  }
}
