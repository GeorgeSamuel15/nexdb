import { acquireFileLock, releaseFileLock, type FileLease } from "./lock.ts";
import { open, mkdir } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname } from "node:path";
import { assert } from "../../common/src/index.ts";
import { PAGE_SIZE, SlottedPage } from "./page.ts";
export * from "./page.ts";
export interface PageStore {
  read(id: number): Promise<Buffer>;
  write(id: number, page: Buffer): Promise<void>;
  sync(): Promise<void>;
  readonly pageCount: number;
}
export class DiskStore implements PageStore {
  private constructor(
    private handle: FileHandle,
    public pageCount: number,
    private lock: FileLease,
  ) {}
  static async open(path: string): Promise<DiskStore> {
    await mkdir(dirname(path), { recursive: true });
    const lock = await acquireFileLock(path);
    let h: FileHandle | undefined;
    try {
      try {
        h = await open(path, "r+");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        h = await open(path, "wx+", 0o600);
      }
      const size = (await h.stat()).size;
      assert(size % PAGE_SIZE === 0, "CORRUPT", "Truncated database file");
      return new DiskStore(h, size / PAGE_SIZE, lock);
    } catch (e) {
      await h?.close();
      await releaseFileLock(lock);
      throw e;
    }
  }
  async read(id: number) {
    assert(
      Number.isInteger(id) && id >= 0 && id < this.pageCount,
      "PAGE",
      "Invalid page ID",
    );
    const b = Buffer.alloc(PAGE_SIZE);
    let at = 0;
    while (at < PAGE_SIZE) {
      const r = await this.handle.read(
        b,
        at,
        PAGE_SIZE - at,
        id * PAGE_SIZE + at,
      );
      assert(r.bytesRead > 0, "CORRUPT", "Short page read");
      at += r.bytesRead;
    }
    new SlottedPage(b).validate(id);
    return b;
  }
  async write(id: number, page: Buffer) {
    assert(
      Number.isInteger(id) && id >= 0 && id <= this.pageCount,
      "PAGE",
      "Non-contiguous page write",
    );
    new SlottedPage(page).validate(id);
    let at = 0;
    while (at < PAGE_SIZE) {
      const r = await this.handle.write(
        page,
        at,
        PAGE_SIZE - at,
        id * PAGE_SIZE + at,
      );
      assert(r.bytesWritten > 0, "IO", "Short write");
      at += r.bytesWritten;
    }
    this.pageCount = Math.max(this.pageCount, id + 1);
  }
  async sync() {
    await this.handle.sync();
  }
  async close() {
    await this.sync();
    await this.handle.close();
    await releaseFileLock(this.lock);
  }
}
