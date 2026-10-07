import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encode, decode } from "../packages/common/src/index.ts";
import { SlottedPage, DiskStore } from "../packages/storage/src/index.ts";
import { BufferPool } from "../packages/buffer-pool/src/index.ts";
test("binary tuple roundtrip, bounds and invalid input", () => {
  const row = [
    null,
    true,
    false,
    32,
    4.5,
    9223372036854775807n,
    "héllo",
    Buffer.from([0, 255]),
  ];
  assert.deepEqual(decode(encode(row)), row);
  assert.throws(() => decode(encode(row).subarray(0, 20)));
  assert.throws(() => encode([1n << 63n]));
});
test("slotted page preserves IDs through deletion, compact and checksum", () => {
  const p = SlottedPage.create(7);
  const a = p.insert(Buffer.from("abc")),
    b = p.insert(Buffer.from("def"));
  p.delete(a);
  assert.equal(p.get(a), null);
  assert.equal(p.get(b)?.toString(), "def");
  p.seal();
  p.validate(7);
  p.bytes[100] = p.bytes[100]! ^ 1;
  assert.throws(() => p.validate(7));
});
test("persistent pages and buffer pin/eviction accounting", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nexdb-"));
  try {
    let d = await DiskStore.open(join(dir, "db"));
    for (let i = 0; i < 3; i++) {
      const p = SlottedPage.create(i);
      p.insert(encode([i]));
      await d.write(i, p.seal());
    }
    await d.close();
    d = await DiskStore.open(join(dir, "db"));
    const pool = new BufferPool(d, 1);
    await pool.pin(0);
    await assert.rejects(() => pool.pin(1));
    pool.unpin(0);
    await pool.pin(0);
    pool.unpin(0);
    await pool.pin(1);
    pool.unpin(1);
    assert.equal(pool.stats.hits, 1);
    assert.equal(pool.stats.evictions, 1);
    assert.deepEqual(decode(new SlottedPage(await d.read(2)).get(0)!), [2]);
    await d.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("free-page tracking survives reopen and reuses allocated IDs", async () => {
  const { PageManager } = await import("../packages/storage/src/manager.ts");
  const dir = await mkdtemp(join(tmpdir(), "nexdb-free-"));
  try {
    const path = join(dir, "db");
    let store = await DiskStore.open(path);
    let manager = await PageManager.open(store);
    assert.equal(await manager.allocate(), 0);
    assert.equal(await manager.allocate(), 1);
    await manager.release(0);
    await store.close();
    store = await DiskStore.open(path);
    manager = await PageManager.open(store);
    assert.deepEqual(manager.freePages, [0]);
    assert.equal(await manager.allocate(), 0);
    await store.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("dirty eviction writes sealed content and refuses pinned flush", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nexdb-dirty-"));
  try {
    const d = await DiskStore.open(join(dir, "db"));
    for (let i = 0; i < 2; i++) await d.write(i, SlottedPage.create(i).seal());
    const pool = new BufferPool(d, 1);
    const page = new SlottedPage(await pool.pin(0));
    page.insert(encode(["persisted"]));
    page.seal();
    pool.unpin(0, true);
    await pool.pin(0);
    await assert.rejects(() => pool.flush(0), /pinned/);
    pool.unpin(0);
    await pool.pin(1);
    pool.unpin(1);
    await pool.flushAll();
    assert.equal(pool.stats.flushes, 1);
    assert.deepEqual(decode(new SlottedPage(await d.read(0)).get(0)!), [
      "persisted",
    ]);
    await d.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
