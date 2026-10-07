import { test } from "node:test";
import assert from "node:assert/strict";
import { BPlusTree } from "../packages/indexes/src/index.ts";
import { parse, tokenize } from "../packages/sql-parser/src/index.ts";
test("randomized multi-level B+ tree, duplicates, range and deletion", () => {
  const tree = new BPlusTree(4);
  let seed = 123;
  const keys = Array.from({ length: 1000 }, (_, i) => i);
  for (let i = 999; i > 0; i--) {
    seed = (1664525 * seed + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [keys[i], keys[j]] = [keys[j]!, keys[i]!];
  }
  for (const i of keys) tree.insert(i, i);
  for (let i = 0; i < 1000; i++) assert.deepEqual(tree.find(i), [i]);
  assert.deepEqual([...tree.range(20, 24)], [20, 21, 22, 23, 24]);
  tree.insert(20, 2000);
  assert.deepEqual(tree.find(20), [20, 2000]);
  tree.delete(20, 20);
  assert.deepEqual(tree.find(20), [2000]);
});
test("lexer locations, escaping, precedence and parser errors", () => {
  assert.equal(tokenize("SELECT\n'name''s'")[1]?.line, 2);
  assert.equal(
    parse("SELECT * FROM t WHERE x = 2 OR y = 3 AND z = 4").kind,
    "select",
  );
  assert.throws(() => parse("SELECT FROM"), /expected/);
  assert.throws(
    () => parse("SELECT * FROM t; DELETE FROM t"),
    /end of statement/,
  );
});
