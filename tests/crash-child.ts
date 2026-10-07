import { writeSync } from "node:fs";
import { Database } from "../packages/executor/src/index.ts";
const db = await Database.open(process.argv[2]!);
await db.query("BEGIN");
await db.query("UPDATE accounts SET balance = balance - 500 WHERE id = 1");
await db.query("UPDATE accounts SET balance = balance + 500 WHERE id = 2");
if (process.argv[3] === "commit") await db.query("COMMIT");
writeSync(1, "NEXDB_CRASH_POINT:uncommitted\n");
process.kill(process.pid, "SIGKILL");
