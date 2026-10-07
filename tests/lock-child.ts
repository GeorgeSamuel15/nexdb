import { acquireFileLock } from "../packages/storage/src/lock.ts";
import { NexError } from "../packages/common/src/index.ts";
try {
  const lease = await acquireFileLock(process.argv[2]!);
  await lease.release();
  process.exitCode = 2;
} catch (error) {
  if (!(error instanceof NexError) || error.code !== "LOCKED") throw error;
  console.log("LOCKED");
}
