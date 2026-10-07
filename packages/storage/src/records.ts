import { assert } from "../../common/src/index.ts";
import { SlottedPage, PAGE_SIZE, HEADER_SIZE, SLOT_SIZE } from "./page.ts";

export const MAX_INLINE_RECORD = PAGE_SIZE - HEADER_SIZE - SLOT_SIZE;
export const MAX_RECORD_SIZE = 16 * 1024 * 1024;
export const MAX_SNAPSHOT_SIZE = 256 * 1024 * 1024;
const OVERFLOW_KIND = 2;
const FRAGMENT_HEADER = 8;
const FRAGMENT_CAPACITY = MAX_INLINE_RECORD - FRAGMENT_HEADER;

/** Kind 0 pages retain the v0.1 layout. Kind 2 holds one ordered fragment. */
export function encodeRecords(records: Buffer[]): Buffer {
  const pages: Buffer[] = [];
  let page = SlottedPage.create(0);
  const flush = () => {
    assert(
      (pages.length + 1) * PAGE_SIZE <= MAX_SNAPSHOT_SIZE,
      "LIMIT",
      "Snapshot exceeds 256 MiB",
    );
    pages.push(page.seal());
    page = SlottedPage.create(pages.length);
  };
  for (const record of records) {
    assert(
      record.length > 0 && record.length <= MAX_RECORD_SIZE,
      "ROW_TOO_LARGE",
      "Record must contain 1 byte to 16 MiB",
    );
    if (record.length <= MAX_INLINE_RECORD) {
      if (record.length + SLOT_SIZE > page.free) flush();
      page.insert(record);
      continue;
    }
    if (page.count) flush();
    for (let offset = 0; offset < record.length; offset += FRAGMENT_CAPACITY) {
      const chunk = record.subarray(offset, offset + FRAGMENT_CAPACITY);
      const fragment = Buffer.alloc(FRAGMENT_HEADER + chunk.length);
      fragment.writeUInt32LE(record.length, 0);
      fragment.writeUInt32LE(offset, 4);
      chunk.copy(fragment, FRAGMENT_HEADER);
      page.bytes.writeUInt16LE(OVERFLOW_KIND, 6);
      page.insert(fragment);
      flush();
    }
  }
  if (page.count || !pages.length) flush();
  return Buffer.concat(pages);
}

/** Streaming decoder checks complete, contiguous chains before returning rows. */
export class RecordDecoder {
  private pending: Buffer | null = null;
  private offset = 0;
  readonly records: Buffer[] = [];
  push(page: SlottedPage) {
    const kind = page.bytes.readUInt16LE(6);
    assert(
      kind === 0 || kind === OVERFLOW_KIND,
      "CORRUPT",
      "Unknown snapshot page kind",
    );
    if (kind === 0) {
      assert(!this.pending, "CORRUPT", "Interrupted overflow record");
      for (let slot = 0; slot < page.count; slot++) {
        const record = page.get(slot);
        if (record) this.records.push(record);
      }
      return;
    }
    assert(
      page.count === 1,
      "CORRUPT",
      "Overflow page must contain one fragment",
    );
    const fragment = page.get(0);
    assert(
      fragment !== null && fragment.length > FRAGMENT_HEADER,
      "CORRUPT",
      "Invalid overflow fragment",
    );
    const total = fragment.readUInt32LE(0),
      offset = fragment.readUInt32LE(4);
    assert(
      total > MAX_INLINE_RECORD && total <= MAX_RECORD_SIZE,
      "CORRUPT",
      "Invalid overflow record length",
    );
    assert(
      offset === this.offset,
      "CORRUPT",
      "Overflow fragment offset mismatch",
    );
    assert(
      fragment.length - FRAGMENT_HEADER ===
        Math.min(FRAGMENT_CAPACITY, total - offset),
      "CORRUPT",
      "Overflow fragment length mismatch",
    );
    if (!this.pending) this.pending = Buffer.alloc(total);
    assert(
      this.pending.length === total,
      "CORRUPT",
      "Overflow record length changed",
    );
    this.offset += fragment.copy(this.pending, offset, FRAGMENT_HEADER);
    if (this.offset === total) {
      this.records.push(this.pending);
      this.pending = null;
      this.offset = 0;
    }
  }
  finish() {
    assert(!this.pending, "CORRUPT", "Truncated overflow record");
    return this.records;
  }
}
