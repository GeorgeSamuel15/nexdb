import { writeSync } from "node:fs";
import { RecordDecoder } from "../../storage/src/records.ts";
import {
  acquireFileLock,
  releaseFileLock,
  type FileLease,
} from "../../storage/src/lock.ts";
import { BufferPool } from "../../buffer-pool/src/index.ts";
import type { PageStore } from "../../storage/src/index.ts";
import { encodeCommit, readCommits } from "../../wal/src/index.ts";
import { validateImage } from "../../recovery/src/index.ts";
import { open, readFile, mkdir } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname } from "node:path";
import { assert } from "../../common/src/index.ts";
import { SlottedPage, PAGE_SIZE } from "../../storage/src/index.ts";
/** Full-image redo WAL, no-steal. Commit record is one checksummed image. */
export class Persistence {
  private file!: FileHandle;
  private wal!: FileHandle;
  private lock!: FileLease;
  generation = 0;
  private walOffset = 0;
  private released = false;
  readonly bufferStats = { hits: 0, misses: 0, evictions: 0, flushes: 0 };
  private constructor(readonly path: string) {}
  static async open(path: string) {
    await mkdir(dirname(path), { recursive: true });
    const p = new Persistence(path);
    p.lock = await acquireFileLock(path);
    try {
      try {
        p.file = await open(path, "r+");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        p.file = await open(path, "wx+", 0o600);
      }
      // Append-only handles on Windows cannot be truncated at checkpoints.
      try {
        p.wal = await open(path + ".wal", "r+");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        p.wal = await open(path + ".wal", "wx+", 0o600);
      }
      await p.recover();
      return p;
    } catch (e) {
      await p.wal?.close();
      await p.file?.close();
      await releaseFileLock(p.lock);
      throw e;
    }
  }
  private async writeAll(h: FileHandle, b: Buffer, position: number | null) {
    let at = 0;
    while (at < b.length) {
      const r = await h.write(
        b,
        at,
        b.length - at,
        position === null ? null : position + at,
      );
      assert(r.bytesWritten > 0, "IO", "Short write");
      at += r.bytesWritten;
    }
  }
  private async recover() {
    const b = await readFile(this.path + ".wal");
    const recovered = readCommits(b);
    this.generation = recovered.lsn;
    this.walOffset = recovered.validBytes;
    if (recovered.image) await this.apply(recovered.image);
    if (recovered.validBytes !== b.length) {
      await this.wal.truncate(recovered.validBytes);
      await this.wal.sync();
    }
  }
  private async apply(image: Buffer) {
    validateImage(image);
    await this.writeAll(this.file, image, 0);
    await this.file.truncate(image.length);
    await this.file.sync();
  }
  async load(): Promise<Buffer[]> {
    const size = (await this.file.stat()).size;
    assert(size % PAGE_SIZE === 0, "CORRUPT", "Truncated database");
    const handle = this.file;
    const store: PageStore = {
      pageCount: size / PAGE_SIZE,
      async read(id) {
        const page = Buffer.alloc(PAGE_SIZE);
        let at = 0;
        while (at < PAGE_SIZE) {
          const r = await handle.read(
            page,
            at,
            PAGE_SIZE - at,
            id * PAGE_SIZE + at,
          );
          assert(r.bytesRead > 0, "CORRUPT", "Short read");
          at += r.bytesRead;
        }
        new SlottedPage(page).validate(id);
        return page;
      },
      async write() {
        throw new Error("Snapshot load is read-only");
      },
      async sync() {
        await handle.sync();
      },
    };
    const pool = new BufferPool(store, 64),
      decoder = new RecordDecoder();
    for (let id = 0; id < store.pageCount; id++) {
      const page = new SlottedPage(await pool.pin(id));
      decoder.push(page);
      pool.unpin(id);
    }
    Object.assign(this.bufferStats, pool.stats);
    return decoder.finish();
  }
  async commit(image: Buffer) {
    validateImage(image);
    const record = encodeCommit(image, ++this.generation);
    await this.writeAll(this.wal, record, this.walOffset);
    this.walOffset += record.length;
    await this.wal.sync();
    if (process.env.NEXDB_TEST_CRASH === "after-wal") {
      writeSync(1, "NEXDB_CRASH_POINT:after-wal\n");
      process.kill(process.pid, "SIGKILL");
    }
    await this.apply(image);
  }
  async checkpoint() {
    await this.file.sync();
    await this.wal.truncate(0);
    this.walOffset = 0;
    await this.wal.sync();
  }
  async close() {
    if (this.released) return;
    this.released = true;
    try {
      try {
        await this.file.close();
      } finally {
        await this.wal.close();
      }
    } finally {
      await releaseFileLock(this.lock);
    }
  }
}
