import { createServer } from "node:net";
import { open, realpath } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, basename, join, normalize } from "node:path";
import { createHash } from "node:crypto";
import { NexError } from "../../common/src/index.ts";
export interface FileLease {
  release(): Promise<void>;
}
/** OS-owned locks are released even when the database process is killed. */
export async function acquireFileLock(path: string): Promise<FileLease> {
  let canonical: string;
  try {
    canonical = await realpath(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    canonical = join(await realpath(dirname(path)), basename(path));
  }
  canonical = normalize(canonical);
  if (process.platform === "linux") {
    const handle = await open(canonical + ".lock", "a+", 0o600);
    // fd 3 shares the parent's open-file description. The flock survives the
    // helper's exit and is released when the parent closes its last descriptor.
    const result = spawnSync("flock", ["--exclusive", "--nonblock", "3"], {
      stdio: ["ignore", "ignore", "pipe", handle.fd],
    });
    if (result.status !== 0) {
      await handle.close();
      throw new NexError(
        "LOCKED",
        result.error
          ? "Linux requires the util-linux flock command"
          : "Database already open",
      );
    }
    return { release: () => handle.close() };
  }
  if (process.platform === "win32") {
    const key = createHash("sha256")
      .update(canonical.toLowerCase())
      .digest("hex");
    const endpoint = String.raw`\\.\pipe\nexdb-${key}`;
    const lock = createServer((socket) => socket.destroy());
    await new Promise<void>((resolve, reject) => {
      lock.once("error", (error) =>
        reject(new NexError("LOCKED", error.message)),
      );
      lock.listen(endpoint, resolve);
    });
    lock.unref();
    return {
      release: () =>
        new Promise((resolve, reject) =>
          lock.close((error) => (error ? reject(error) : resolve())),
        ),
    };
  }
  throw new NexError(
    "PLATFORM",
    "Process locks currently support Linux and Windows",
  );
}
export function releaseFileLock(lock: FileLease) {
  return lock.release();
}
