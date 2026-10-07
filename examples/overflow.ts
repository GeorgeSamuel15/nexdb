import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../packages/executor/src/index.ts";
const dir = await mkdtemp(join(tmpdir(), "nexdb-overflow-demo-"));
let db: Database | undefined;
try {
  const path = join(dir, "demo.ndb");
  db = await Database.open(path);
  await db.query(
    "CREATE TABLE documents (id INT PRIMARY KEY, body TEXT, data BLOB)",
  );
  const body = "NexDB stores this across multiple pages. ".repeat(1000);
  const data = Buffer.alloc(24000, 42);
  await db.query("INSERT INTO documents VALUES (?, ?, ?)", [1, body, data]);
  await db.checkpoint();
  await db.close();
  db = undefined;
  db = await Database.open(path);
  assert.deepEqual(
    (await db.query("SELECT * FROM documents WHERE id = 1")).rows,
    [{ id: 1, body, data }],
  );
  console.log(
    `Verified after restart: ${Buffer.byteLength(body)} text bytes and ${data.length} binary bytes.`,
  );
} finally {
  await db?.close();
  await rm(dir, { recursive: true, force: true });
}
