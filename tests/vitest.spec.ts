import { it, expect } from "vitest";
import { spawnSync } from "node:child_process";
it("runs real storage, parser, index, engine, protocol and crash integration tests", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--test",
      ...[
        "storage",
        "indexes",
        "engine",
        "recovery",
        "network",
        "cli",
        "overflow",
        "lock",
      ].map((s) => `tests/${s}.test.ts`),
    ],
    { encoding: "utf8" },
  );
  console.log(result.stdout);
  expect(result.status, result.stderr + result.stdout).toBe(0);
}, 120000);
