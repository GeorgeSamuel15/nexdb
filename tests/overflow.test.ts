import { assertCrash } from "./crash-assert.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Database } from "../packages/executor/src/index.ts";
import {
  encodeRecords,
  RecordDecoder,
  MAX_INLINE_RECORD,
  MAX_RECORD_SIZE,
} from "../packages/storage/src/records.ts";
import { SlottedPage, PAGE_SIZE } from "../packages/storage/src/index.ts";
import { validateImage } from "../packages/recovery/src/index.ts";
import { serialize } from "../packages/catalog/src/index.ts";

function decode(image: Buffer) {
  const decoder = new RecordDecoder();
  for (let at = 0; at < image.length; at += PAGE_SIZE) {
    const page = new SlottedPage(image.subarray(at, at + PAGE_SIZE));
    page.validate(at / PAGE_SIZE);
    decoder.push(page);
  }
  return decoder.finish();
}

test("record boundaries, mixed inline/overflow and maximum length roundtrip", () => {
  const records = [
    1,
    MAX_INLINE_RECORD,
    MAX_INLINE_RECORD + 1,
    8104,
    8105,
    100000,
    MAX_RECORD_SIZE,
  ].map((length, i) => Buffer.alloc(length, i + 1));
  const image = encodeRecords(records);
  assert.deepEqual(decode(image), records);
  assert.throws(
    () => encodeRecords([Buffer.alloc(MAX_RECORD_SIZE + 1)]),
    /16 MiB/,
  );
});

test("overflow corruption is rejected even when page checksums are valid", () => {
  const original = encodeRecords([Buffer.alloc(10000, 7)]);
  assert.throws(
    () => validateImage(original.subarray(0, PAGE_SIZE)),
    /Truncated overflow/,
  );
  for (const mutation of ["offset", "total", "kind"]) {
    const image = Buffer.from(original);
    const page = new SlottedPage(image.subarray(PAGE_SIZE, PAGE_SIZE * 2));
    const recordOffset = page.bytes.readUInt16LE(32);
    if (mutation === "offset") page.bytes.writeUInt32LE(1, recordOffset + 4);
    if (mutation === "total") page.bytes.writeUInt32LE(12000, recordOffset);
    if (mutation === "kind") page.bytes.writeUInt16LE(99, 6);
    page.seal();
    assert.throws(() => validateImage(image), /overflow|Overflow|page kind/);
  }
});

test("large SQL text/blob, indexes, rollback, delete and checkpoint survive restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nexdb-overflow-")),
    path = join(dir, "db");
  let db: Database | undefined;
  try {
    db = await Database.open(path);
    await db.query(
      "CREATE TABLE documents (id INT PRIMARY KEY, body TEXT, payload BLOB)",
    );
    const body = "NexDB 🌍 ".repeat(3000),
      payload = Buffer.alloc(24000, 195);
    await db.query("INSERT INTO documents VALUES (?, ?, ?)", [
      1,
      body,
      payload,
    ]);
    await db.query("CREATE INDEX idx_body ON documents(body)");
    await db.query("BEGIN");
    await db.query("UPDATE documents SET body = ? WHERE id = 1", [
      "changed".repeat(3000),
    ]);
    await db.query("ROLLBACK");
    await db.checkpoint();
    await db.close();
    db = await Database.open(path);
    assert.deepEqual(
      (await db.query("SELECT * FROM documents WHERE body = ?", [body])).rows,
      [{ id: 1, body, payload }],
    );
    await db.query("UPDATE documents SET body = 'small' WHERE id = 1");
    await db.query("DELETE FROM documents WHERE id = 1");
    await db.close();
    db = await Database.open(path);
    assert.deepEqual((await db.query("SELECT * FROM documents")).rows, []);
  } finally {
    await db?.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("v0.1 inline snapshot opens and remains writable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nexdb-legacy-")),
    path = join(dir, "db");
  try {
    const page = SlottedPage.create(0);
    for (const record of serialize([])) page.insert(record);
    await writeFile(path, page.seal());
    const db = await Database.open(path);
    await db.query("CREATE TABLE t (id INT)");
    await db.query("INSERT INTO t VALUES (1)");
    assert.deepEqual((await db.query("SELECT * FROM t")).rows, [{ id: 1 }]);
    await db.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("large committed row recovers after SIGKILL between WAL sync and data write", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nexdb-overflow-crash-")),
    path = join(dir, "db");
  let db: Database | undefined;
  try {
    db = await Database.open(path);
    await db.query("CREATE TABLE t (id INT PRIMARY KEY, body TEXT)");
    await db.checkpoint();
    await db.close();
    const before = await readFile(path);
    const child = spawnSync(
      process.execPath,
      ["--import", "tsx", "tests/overflow-crash-child.ts", path],
      { env: { ...process.env, NEXDB_TEST_CRASH: "after-wal" } },
    );
    assertCrash(child, "after-wal");
    assert.deepEqual(await readFile(path), before);
    db = await Database.open(path);
    assert.deepEqual((await db.query("SELECT * FROM t")).rows, [
      { id: 1, body: "recover".repeat(5000) },
    ]);
    await db.close();
  } finally {
    await db?.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("oversized SQL record fails before WAL and leaves the session usable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nexdb-limit-")),
    path = join(dir, "db");
  const db = await Database.open(path);
  try {
    await db.query("CREATE TABLE t (id INT, body TEXT)");
    const before = await readFile(path + ".wal");
    await assert.rejects(
      () =>
        db.query("INSERT INTO t VALUES (?, ?)", [
          1,
          "x".repeat(MAX_RECORD_SIZE),
        ]),
      /16 MiB/,
    );
    assert.deepEqual(await readFile(path + ".wal"), before);
    await db.query("INSERT INTO t VALUES (2, 'ok')");
    assert.deepEqual((await db.query("SELECT * FROM t")).rows, [
      { id: 2, body: "ok" },
    ]);
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
