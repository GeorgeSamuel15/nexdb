import { assertCrash } from "./crash-assert.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, appendFile, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../packages/executor/src/index.ts";
for (const mode of ["uncommitted", "commit"])
  test(`SIGKILL recovery: ${mode}`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "nexdb-crash-")),
      path = join(dir, "db");
    let db: Database | undefined;
    try {
      db = await Database.open(path);
      await db.query("CREATE TABLE accounts (id INT PRIMARY KEY,balance INT)");
      await db.query("INSERT INTO accounts VALUES (1,1000),(2,200)");
      await db.close();
      const child = spawnSync(
        process.execPath,
        ["--import", "tsx", "tests/crash-child.ts", path, mode],
        {
          env: {
            ...process.env,
            NEXDB_TEST_CRASH: mode === "commit" ? "after-wal" : "",
          },
        },
      );
      assertCrash(child, mode === "commit" ? "after-wal" : "uncommitted");
      await appendFile(path + ".wal", Buffer.from("NX"));
      db = await Database.open(path);
      assert.deepEqual(
        (await db.query("SELECT balance FROM accounts ORDER BY id")).rows,
        mode === "commit"
          ? [{ balance: 500 }, { balance: 700 }]
          : [{ balance: 1000 }, { balance: 200 }],
      );
      await db.close();
    } finally {
      await db?.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
test("checksum detects database corruption after checkpoint", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nexdb-corrupt-")),
    path = join(dir, "db");
  let db: Database | undefined;
  try {
    db = await Database.open(path);
    await db.query("CREATE TABLE t (id INT)");
    await db.checkpoint();
    await db.close();
    const b = await readFile(path);
    b[100] = b[100]! ^ 1;
    await writeFile(path, b);
    await assert.rejects(() => Database.open(path), /checksum/);
  } finally {
    await db?.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("WAL rejects corrupt headers and payloads and ignores a torn final record", async () => {
  const { encodeCommit, readCommits } =
    await import("../packages/wal/src/index.ts");
  const { SlottedPage } = await import("../packages/storage/src/index.ts");
  const record = encodeCommit(SlottedPage.create(0).seal(), 1);
  assert.equal(
    readCommits(Buffer.concat([record, record.subarray(0, 100)])).validBytes,
    record.length,
  );
  const header = Buffer.from(record);
  header[8] = header[8]! ^ 1;
  assert.throws(() => readCommits(header), /header checksum/);
  const payload = Buffer.from(record);
  payload[100] = payload[100]! ^ 1;
  assert.throws(() => readCommits(payload), /WAL checksum/);
});

test("WAL appends correctly after checkpoint, reopen and torn-tail recovery", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nexdb-wal-offset-"));
  const path = join(dir, "db");
  let db: Database | undefined;
  try {
    db = await Database.open(path);
    await db.query("CREATE TABLE t (id INT PRIMARY KEY)");
    await db.query("INSERT INTO t VALUES (1)");
    await db.checkpoint();
    assert.equal((await readFile(path + ".wal")).length, 0);
    await db.query("INSERT INTO t VALUES (2)");
    await db.close();
    db = await Database.open(path);
    await db.query("INSERT INTO t VALUES (3)");
    await db.close();
    await appendFile(path + ".wal", Buffer.from("NX"));
    db = await Database.open(path);
    await db.query("INSERT INTO t VALUES (4)");
    await db.close();
    // Force replay to prove every post-checkpoint append was durable and framed.
    await writeFile(path, Buffer.alloc(0));
    db = await Database.open(path);
    assert.deepEqual((await db.query("SELECT * FROM t ORDER BY id")).rows, [
      { id: 1 },
      { id: 2 },
      { id: 3 },
      { id: 4 },
    ]);
  } finally {
    await db?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
