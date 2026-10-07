import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("CLI accepts redirected multiline input and persists across processes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nexdb-cli-"));
  try {
    const run = (input: string) =>
      spawnSync(
        process.execPath,
        ["--import", "tsx", "apps/cli/src/index.ts", dir],
        { input, encoding: "utf8" },
      );
    const first = run(
      "CREATE TABLE t (id INT PRIMARY KEY, name TEXT);\nINSERT INTO t VALUES (1, 'George');\n.exit\n",
    );
    assert.equal(first.status, 0, first.stderr);
    const second = run("SELECT * FROM t;\n.exit\n");
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /George/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
