import { assert } from "../../common/src/index.ts";
import { DiskStore, SlottedPage } from "./index.ts";
/** Free-page state lives in the page header, so it survives restart. */
export class PageManager {
  private free = new Set<number>();
  private constructor(readonly store: DiskStore) {}
  static async open(store: DiskStore) {
    const manager = new PageManager(store);
    for (let id = 0; id < store.pageCount; id++) {
      const page = await store.read(id);
      if (page.readUInt16LE(6) === 1) manager.free.add(id);
    }
    return manager;
  }
  get freePages() {
    return [...this.free];
  }
  async allocate() {
    const id = this.free.values().next().value ?? this.store.pageCount;
    const page = SlottedPage.create(id);
    await this.store.write(id, page.seal());
    this.free.delete(id);
    return id;
  }
  async release(id: number) {
    assert(!this.free.has(id), "PAGE", "Page already free");
    await this.store.read(id);
    const page = SlottedPage.create(id);
    page.bytes.writeUInt16LE(1, 6);
    await this.store.write(id, page.seal());
    this.free.add(id);
  }
}
