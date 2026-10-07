import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../packages/executor/src/index.ts";
const dir = await mkdtemp(join(tmpdir(), "nexdb-bench-")),
  path = join(dir, "db");
const db = await Database.open(path);
try {
  await db.query("CREATE TABLE items (id INT PRIMARY KEY, value TEXT)");
  const start = performance.now();
  await db.query(
    "INSERT INTO items VALUES " +
      Array.from({ length: 10000 }, (_, i) => `(${i},'value${i}')`).join(","),
  );
  console.log(
    JSON.stringify({
      benchmark: "10000 rows, one durable transaction",
      ms: performance.now() - start,
      node: process.version,
      platform: process.platform,
    }),
  );
  for (const sql of [
    "SELECT * FROM items WHERE id = 9999",
    "SELECT * FROM items",
    "UPDATE items SET value = 'changed' WHERE id = 5000",
    "DELETE FROM items WHERE id = 5000",
  ]) {
    const r = await db.query(sql);
    console.log(JSON.stringify({ sql, ms: r.timeMs, rows: r.rows.length }));
  }
} finally {
  await db.close();
  await rm(dir, { recursive: true, force: true });
}
