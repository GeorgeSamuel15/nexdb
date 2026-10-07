import assert from "node:assert/strict";
import type { SpawnSyncReturns } from "node:child_process";
/** Windows reports forced termination as an exit code, not a POSIX signal. */
export function assertCrash(child: SpawnSyncReturns<Buffer>, point: string) {
  assert.ifError(child.error);
  assert.ok(
    child.stdout.toString().includes(`NEXDB_CRASH_POINT:${point}\n`),
    `Child did not reach crash boundary: ${child.stderr.toString()}`,
  );
  assert.equal(child.stderr.toString(), "");
  if (process.platform === "win32") {
    assert.ok(
      child.signal === "SIGKILL" ||
        (typeof child.status === "number" && child.status !== 0),
      "Expected forced Windows process termination",
    );
  } else {
    assert.equal(child.signal, "SIGKILL");
  }
}
