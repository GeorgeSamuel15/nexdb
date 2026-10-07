import { assert, checksum } from "../../common/src/index.ts";
export const PAGE_SIZE = 4096,
  HEADER_SIZE = 32,
  SLOT_SIZE = 4;
export class SlottedPage {
  constructor(public bytes: Buffer) {
    assert(bytes.length === PAGE_SIZE, "CORRUPT", "Page size");
  }
  static create(id: number): SlottedPage {
    const b = Buffer.alloc(PAGE_SIZE);
    b.write("NXPG");
    b.writeUInt16LE(1, 4);
    b.writeUInt32LE(id, 8);
    b.writeUInt16LE(PAGE_SIZE, 18);
    return new SlottedPage(b);
  }
  get id() {
    return this.bytes.readUInt32LE(8);
  }
  get count() {
    return this.bytes.readUInt16LE(16);
  }
  get free() {
    return this.bytes.readUInt16LE(18) - HEADER_SIZE - this.count * SLOT_SIZE;
  }
  seal(): Buffer {
    this.bytes.writeUInt32LE(0, 24);
    this.bytes.writeUInt32LE(checksum(this.bytes), 24);
    return this.bytes;
  }
  validate(expected?: number) {
    assert(
      this.bytes.toString("ascii", 0, 4) === "NXPG" &&
        this.bytes.readUInt16LE(4) === 1,
      "CORRUPT",
      "Page magic/version",
    );
    const copy = Buffer.from(this.bytes);
    const crc = copy.readUInt32LE(24);
    copy.writeUInt32LE(0, 24);
    assert(checksum(copy) === crc, "CORRUPT", "Page checksum");
    assert(
      expected === undefined || this.id === expected,
      "CORRUPT",
      "Page ID mismatch",
    );
    assert(
      this.count <= (PAGE_SIZE - HEADER_SIZE) / SLOT_SIZE &&
        this.free >= 0 &&
        this.bytes.readUInt16LE(18) <= PAGE_SIZE,
      "CORRUPT",
      "Slot directory overlaps records",
    );
    const spans: [number, number][] = [];
    for (let i = 0; i < this.count; i++) {
      const pos = HEADER_SIZE + i * SLOT_SIZE;
      const off = this.bytes.readUInt16LE(pos),
        len = this.bytes.readUInt16LE(pos + 2);
      if (len) {
        assert(
          off >= this.bytes.readUInt16LE(18) && off + len <= PAGE_SIZE,
          "CORRUPT",
          "Slot bounds",
        );
        spans.push([off, off + len]);
      }
    }
    spans.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < spans.length; i++)
      assert(spans[i]![0] >= spans[i - 1]![1], "CORRUPT", "Overlapping slots");
  }
  get(slot: number): Buffer | null {
    assert(
      Number.isInteger(slot) && slot >= 0 && slot < this.count,
      "RID",
      "Invalid slot",
    );
    const p = HEADER_SIZE + slot * SLOT_SIZE;
    const len = this.bytes.readUInt16LE(p + 2);
    return len
      ? Buffer.from(
          this.bytes.subarray(
            this.bytes.readUInt16LE(p),
            this.bytes.readUInt16LE(p) + len,
          ),
        )
      : null;
  }
  insert(record: Buffer): number {
    assert(
      record.length > 0 && record.length + SLOT_SIZE <= this.free,
      "PAGE_FULL",
      "Record does not fit",
    );
    const slot = this.count,
      off = this.bytes.readUInt16LE(18) - record.length;
    record.copy(this.bytes, off);
    this.bytes.writeUInt16LE(off, HEADER_SIZE + slot * SLOT_SIZE);
    this.bytes.writeUInt16LE(record.length, HEADER_SIZE + slot * SLOT_SIZE + 2);
    this.bytes.writeUInt16LE(slot + 1, 16);
    this.bytes.writeUInt16LE(off, 18);
    return slot;
  }
  delete(slot: number) {
    this.get(slot);
    this.bytes.writeUInt16LE(0, HEADER_SIZE + slot * SLOT_SIZE + 2);
    this.compact();
  }
  compact() {
    const records = Array.from({ length: this.count }, (_, i) => this.get(i));
    this.bytes.fill(0, HEADER_SIZE + this.count * SLOT_SIZE);
    let off = PAGE_SIZE;
    records.forEach((record, i) => {
      if (record) {
        off -= record.length;
        record.copy(this.bytes, off);
      }
      this.bytes.writeUInt16LE(record ? off : 0, HEADER_SIZE + i * SLOT_SIZE);
      this.bytes.writeUInt16LE(
        record?.length ?? 0,
        HEADER_SIZE + i * SLOT_SIZE + 2,
      );
    });
    this.bytes.writeUInt16LE(off, 18);
  }
}
