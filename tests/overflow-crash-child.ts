import { Database } from "../packages/executor/src/index.ts";
const db = await Database.open(process.argv[2]!);
await db.query("INSERT INTO t VALUES (?, ?)", [1, "recover".repeat(5000)]);
await db.close();
