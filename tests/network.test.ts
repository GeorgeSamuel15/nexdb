import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startServer } from "../apps/server/src/server.ts";
import { NexDB } from "../packages/client/src/index.ts";
import { Decoder, frame } from "../packages/protocol/src/index.ts";
test("protocol fragmentation, coalescing and oversized lengths", () => {
  const d = new Decoder(),
    b = frame({ x: 1 });
  assert.deepEqual(d.push(b.subarray(0, 2)), []);
  assert.deepEqual(d.push(Buffer.concat([b.subarray(2), b])), [
    { x: 1 },
    { x: 1 },
  ]);
  assert.throws(() => new Decoder().push(Buffer.from([255, 255, 255, 255])));
});
test("TCP authentication, parameters, concurrent clients and transaction exclusion", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nexdb-net-")),
    server = await startServer({
      path: join(dir, "db"),
      password: "testing-password",
      port: 0,
    });
  const port = (server.server.address() as { port: number }).port;
  const a = new NexDB({ port, user: "admin", password: "testing-password" }),
    b = new NexDB({ port, user: "admin", password: "testing-password" }),
    bad = new NexDB({ port, user: "admin", password: "wrong" });
  try {
    await assert.rejects(() => bad.connect(), /credentials/);
    await a.connect();
    await b.connect();
    await a.query(
      "CREATE TABLE t (id BIGINT PRIMARY KEY, balance INT, name TEXT)",
    );
    await a.query("INSERT INTO t VALUES (?, ?, ?)", [
      1n,
      100,
      "x'); DROP TABLE t; --",
    ]);
    await a.query("BEGIN");
    await a.query("UPDATE t SET balance = balance + 50 WHERE id = 1");
    let finished = false;
    const waiting = b.query("SELECT * FROM t").then((r) => {
      finished = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(finished, false);
    await a.query("COMMIT");
    const result = await waiting;
    assert.equal(result.rows[0]?.balance, 150);
    assert.equal(result.rows[0]?.id, 1n);
    await a.query("BEGIN");
    await a.query("DELETE FROM t");
    a.close();
    assert.equal((await b.query("SELECT * FROM t")).rows.length, 1);
  } finally {
    a.close();
    b.close();
    bad.close();
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
