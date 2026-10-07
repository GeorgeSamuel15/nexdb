export type Value = null | boolean | number | bigint | string | Buffer;
export type Row = Record<string, Value>;
export type DataType =
  | "INT"
  | "BIGINT"
  | "FLOAT"
  | "BOOLEAN"
  | "TEXT"
  | "VARCHAR"
  | "DATE"
  | "TIMESTAMP"
  | "BLOB";
export interface Column {
  name: string;
  type: DataType;
  length?: number;
  primary?: boolean;
  unique?: boolean;
  notNull?: boolean;
  defaultValue?: Value;
}
export class NexError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "NexError";
  }
}
export function assert(ok: unknown, code: string, message: string): asserts ok {
  if (!ok) throw new NexError(code, message);
}
export function checksum(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function compare(a: Value, b: Value): number {
  if (a === b) return 0;
  if (
    (typeof a === "number" || typeof a === "bigint") &&
    (typeof b === "number" || typeof b === "bigint")
  )
    return a < b ? -1 : a > b ? 1 : 0;
  if (a === null) return -1;
  if (b === null) return 1;
  if (Buffer.isBuffer(a) && Buffer.isBuffer(b)) return Buffer.compare(a, b);
  return a < b ? -1 : 1;
}
export function encode(values: Value[]): Buffer {
  const chunks: Buffer[] = [Buffer.from([1])];
  const count = Buffer.alloc(4);
  count.writeUInt32LE(values.length);
  chunks.push(count);
  for (const v of values) {
    let tag: number;
    let payload: Buffer;
    if (v === null) {
      tag = 0;
      payload = Buffer.alloc(0);
    } else if (typeof v === "boolean") {
      tag = 1;
      payload = Buffer.from([Number(v)]);
    } else if (typeof v === "number") {
      assert(Number.isFinite(v), "TYPE", "Non-finite number");
      tag = 2;
      payload = Buffer.alloc(8);
      payload.writeDoubleLE(v);
    } else if (typeof v === "bigint") {
      assert(v >= -(1n << 63n) && v < 1n << 63n, "TYPE", "BIGINT out of range");
      tag = 3;
      payload = Buffer.alloc(8);
      payload.writeBigInt64LE(v);
    } else if (typeof v === "string") {
      tag = 4;
      payload = Buffer.from(v);
    } else {
      tag = 5;
      payload = v;
    }
    const header = Buffer.alloc(5);
    header[0] = tag;
    header.writeUInt32LE(payload.length, 1);
    chunks.push(header, payload);
  }
  return Buffer.concat(chunks);
}
export function decode(b: Buffer): Value[] {
  assert(b.length >= 5 && b[0] === 1, "CORRUPT", "Invalid tuple version");
  const n = b.readUInt32LE(1);
  assert(n <= (b.length - 5) / 5, "CORRUPT", "Invalid tuple count");
  let at = 5;
  const values: Value[] = [];
  for (let i = 0; i < n; i++) {
    assert(at + 5 <= b.length, "CORRUPT", "Truncated tuple");
    const tag = b[at]!;
    const len = b.readUInt32LE(at + 1);
    at += 5;
    assert(at + len <= b.length, "CORRUPT", "Truncated value");
    const p = b.subarray(at, at + len);
    at += len;
    switch (tag) {
      case 0:
        assert(len === 0, "CORRUPT", "NULL size");
        values.push(null);
        break;
      case 1:
        assert(len === 1 && p[0]! <= 1, "CORRUPT", "Boolean size");
        values.push(p[0] === 1);
        break;
      case 2:
        assert(len === 8, "CORRUPT", "Number size");
        values.push(p.readDoubleLE());
        break;
      case 3:
        assert(len === 8, "CORRUPT", "BIGINT size");
        values.push(p.readBigInt64LE());
        break;
      case 4:
        values.push(p.toString());
        break;
      case 5:
        values.push(Buffer.from(p));
        break;
      default:
        throw new NexError("CORRUPT", "Unknown tuple tag");
    }
  }
  assert(at === b.length, "CORRUPT", "Trailing tuple bytes");
  return values;
}
