import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../packages/executor/src/index.ts";
async function fixture(fn: (path: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "nexdb-"));
  try {
    await fn(join(dir, "db"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
test("milestone SQL, persisted catalog/index, restart, unique and rollback", () =>
  fixture(async (path) => {
    let db = await Database.open(path);
    await db.query(
      "CREATE TABLE users (id BIGINT PRIMARY KEY, username VARCHAR(100) NOT NULL, email VARCHAR(255) UNIQUE, age INT)",
    );
    await db.query(
      "INSERT INTO users VALUES (1, 'george', 'george@nexdb.dev', 25)",
    );
    assert.equal(
      (await db.query("SELECT * FROM users WHERE id = 1")).rows[0]?.username,
      "george",
    );
    await assert.rejects(() =>
      db.query("INSERT INTO users VALUES (2, 'x','george@nexdb.dev',4)"),
    );
    await db.query("BEGIN");
    await db.query("DELETE FROM users WHERE id = 1");
    await db.query("ROLLBACK");
    await db.query("CREATE INDEX idx_users_email ON users(email)");
    await db.close();
    db = await Database.open(path);
    assert.equal((await db.query("SELECT * FROM users")).rows.length, 1);
    assert.match(
      (
        await db.query(
          "EXPLAIN SELECT * FROM users WHERE email = 'george@nexdb.dev'",
        )
      ).plan!,
      /IndexScan/,
    );
    await db.close();
  }));
test("transfer, expression semantics, parameters and statement atomicity", () =>
  fixture(async (path) => {
    const db = await Database.open(path);
    await db.query(
      "CREATE TABLE accounts (id INT PRIMARY KEY, balance INT NOT NULL, note TEXT)",
    );
    await db.query("INSERT INTO accounts VALUES (1,1000,NULL),(2,200,NULL)");
    await db.query("BEGIN");
    await db.query("UPDATE accounts SET balance = balance - 500 WHERE id = 1");
    await db.query("UPDATE accounts SET balance = balance + 500 WHERE id = 2");
    await db.query("COMMIT");
    assert.deepEqual(
      (await db.query("SELECT balance FROM accounts ORDER BY id")).rows,
      [{ balance: 500 }, { balance: 700 }],
    );
    await assert.rejects(() => db.query("UPDATE accounts SET id = 1"));
    assert.equal(
      (await db.query("SELECT * FROM accounts WHERE id = ?", [2])).rows[0]
        ?.balance,
      700,
    );
    assert.equal(
      (await db.query("SELECT * FROM accounts WHERE note = NULL")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("SELECT * FROM accounts WHERE note IS NULL")).rows.length,
      2,
    );
    await assert.rejects(() => db.query("SELECT unknown FROM accounts"));
    await db.close();
  }));
test("10,000 records, index split and indexed lookup after reopening", () =>
  fixture(async (path) => {
    let db = await Database.open(path);
    await db.query("CREATE TABLE items (id INT PRIMARY KEY, name TEXT)");
    await db.query(
      "INSERT INTO items VALUES " +
        Array.from({ length: 10000 }, (_, i) => `(${i}, 'item${i}')`).join(","),
    );
    await db.close();
    db = await Database.open(path);
    assert.equal(
      (await db.query("SELECT * FROM items WHERE id = 9321")).rows[0]?.name,
      "item9321",
    );
    assert.equal((await db.query("SELECT * FROM items")).rows.length, 10000);
    await db.close();
  }));

test("defaults, NULL uniqueness, types, sorting, DISTINCT and parameter safety", () =>
  fixture(async (path) => {
    const db = await Database.open(path);
    await db.query(
      "CREATE TABLE t (id INT PRIMARY KEY, n INT DEFAULT 7, flag BOOLEAN, d DATE, stamp TIMESTAMP, bytes BLOB, name VARCHAR(8) UNIQUE)",
    );
    await db.query(
      "INSERT INTO t (id, flag, d, stamp, bytes) VALUES (?, ?, ?, ?, ?)",
      [1, true, "2026-10-05", "2026-10-05T10:00:00Z", Buffer.from([0, 255])],
    );
    await db.query("INSERT INTO t (id) VALUES (2)");
    assert.deepEqual((await db.query("SELECT DISTINCT n FROM t")).rows, [
      { n: 7 },
    ]);
    assert.equal(
      (await db.query("SELECT * FROM t ORDER BY id DESC LIMIT 1 OFFSET 1"))
        .rows[0]?.id,
      1,
    );
    assert.deepEqual(
      (await db.query("SELECT bytes FROM t WHERE id=1")).rows[0]?.bytes,
      Buffer.from([0, 255]),
    );
    assert.equal(
      (await db.query("SELECT * FROM t WHERE id = NULL")).rows.length,
      0,
    );
    await assert.rejects(() =>
      db.query("UPDATE t SET d='2026-02-30' WHERE id=1"),
    );
    await assert.rejects(() =>
      db.query("UPDATE t SET name='excessively long'"),
    );
    await assert.rejects(() =>
      db.query("INSERT INTO t (id) VALUES (2147483648)"),
    );
    await db.close();
  }));

test("failed statement keeps active transaction usable, close rolls it back", () =>
  fixture(async (path) => {
    let db = await Database.open(path);
    await db.query("CREATE TABLE t (id INT PRIMARY KEY)");
    await db.query("BEGIN");
    await db.query("INSERT INTO t VALUES (1)");
    await assert.rejects(() => db.query("INSERT INTO t VALUES (2),(1)"));
    assert.equal((await db.query("SELECT * FROM t")).rows.length, 1);
    await db.query("INSERT INTO t VALUES (3)");
    await db.close();
    db = await Database.open(path);
    assert.equal((await db.query("SELECT * FROM t")).rows.length, 0);
    await db.close();
  }));

test("exclusive process lock and concurrent embedded autocommit calls", () =>
  fixture(async (path) => {
    const db = await Database.open(path);
    await assert.rejects(async () => {
      const unexpected = await Database.open(path);
      await unexpected.close();
    });
    await db.query("CREATE TABLE t (id INT PRIMARY KEY)");
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        db.query("INSERT INTO t VALUES (?)", [i]),
      ),
    );
    assert.equal((await db.query("SELECT * FROM t")).rows.length, 20);
    await db.close();
  }));
