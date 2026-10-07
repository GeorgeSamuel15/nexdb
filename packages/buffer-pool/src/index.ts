import { assert } from "../../common/src/index.ts";
import type { PageStore } from "../../storage/src/index.ts";
interface Frame {
  page: Buffer;
  pins: number;
  dirty: boolean;
  used: number;
}
/** Single engine operation at a time; callers serialize concurrent access. */
export class BufferPool {
  private frames = new Map<number, Frame>();
  private clock = 0;
  readonly stats = { hits: 0, misses: 0, evictions: 0, flushes: 0 };
  constructor(
    private store: PageStore,
    private capacity = 64,
  ) {
    assert(
      Number.isInteger(capacity) && capacity > 0,
      "CONFIG",
      "Invalid buffer capacity",
    );
  }
  async pin(id: number): Promise<Buffer> {
    let frame = this.frames.get(id);
    if (frame) this.stats.hits++;
    else {
      this.stats.misses++;
      if (this.frames.size >= this.capacity) {
        const victim = [...this.frames]
          .filter(([, f]) => f.pins === 0)
          .sort((a, b) => a[1].used - b[1].used)[0];
        assert(victim, "BUFFER_FULL", "All pages are pinned");
        await this.flush(victim[0]);
        this.frames.delete(victim[0]);
        this.stats.evictions++;
      }
      frame = {
        page: await this.store.read(id),
        pins: 0,
        dirty: false,
        used: 0,
      };
      this.frames.set(id, frame);
    }
    frame.pins++;
    frame.used = ++this.clock;
    return frame.page;
  }
  unpin(id: number, dirty = false) {
    const f = this.frames.get(id);
    assert(f && f.pins > 0, "PIN", "Page is not pinned");
    f.pins--;
    f.dirty ||= dirty;
  }
  async flush(id: number) {
    const f = this.frames.get(id);
    if (f?.dirty) {
      assert(f.pins === 0, "PIN", "Cannot flush a pinned page");
      await this.store.write(id, f.page);
      f.dirty = false;
      this.stats.flushes++;
    }
  }
  async flushAll() {
    for (const id of this.frames.keys()) await this.flush(id);
    await this.store.sync();
  }
  clear() {
    assert(
      [...this.frames.values()].every((f) => f.pins === 0 && !f.dirty),
      "PIN",
      "Dirty or pinned frames",
    );
    this.frames.clear();
  }
}
