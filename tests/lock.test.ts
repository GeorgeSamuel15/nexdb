import { NexError } from "../packages/common/src/index.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { acquireFileLock } from "../packages/storage/src/lock.ts";

test("lock identity survives file creation and excludes a separate process", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nexdb-lock-path-"));
  const path = join(dir, "db");
  const lease = await acquireFileLock(path);
  try {
    await writeFile(path, "");
    const paths =
      process.platform === "win32"
        ? [path, path.replaceAll("\\", "/")]
        : [path];
    for (const candidate of paths) {
      await assert.rejects(
        async () => {
          const unexpected = await acquireFileLock(candidate);
          await unexpected.release();
        },
        (error: unknown) =>
          error instanceof NexError && error.code === "LOCKED",
      );
      const child = spawnSync(process.execPath, [
        "--import",
        "tsx",
        "tests/lock-child.ts",
        candidate,
      ]);
      assert.ifError(child.error);
      assert.equal(child.status, 0, child.stderr.toString());
      assert.equal(child.stdout.toString().trim(), "LOCKED");
    }
  } finally {
    await lease.release();
  }
  try {
    const reopened = await acquireFileLock(path);
    await reopened.release();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
