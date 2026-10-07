import { z } from "zod";
import { assert, type Value } from "../../common/src/index.ts";
export const MAX_MESSAGE = 1024 * 1024;
const value = z.union([
  z.null(),
  z.boolean(),
  z.number().finite(),
  z.string(),
  z.object({ $bigint: z.string().regex(/^-?\d{1,20}$/) }).strict(),
  z.object({ $blob: z.string().max(MAX_MESSAGE) }).strict(),
]);
export const request = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("hello"),
      id: z.number().int().nonnegative(),
      version: z.literal(1),
      user: z.string().max(100),
      password: z.string().max(1024),
      database: z.literal("main").default("main"),
    })
    .strict(),
  z
    .object({
      type: z.literal("query"),
      id: z.number().int().nonnegative(),
      sql: z.string().max(MAX_MESSAGE),
      params: z.array(value).max(10000).default([]),
    })
    .strict(),
  z
    .object({ type: z.literal("close"), id: z.number().int().nonnegative() })
    .strict(),
]);
export function toWire(v: unknown): unknown {
  if (typeof v === "bigint") return { $bigint: String(v) };
  if (Buffer.isBuffer(v)) return { $blob: v.toString("base64") };
  if (Array.isArray(v)) return v.map(toWire);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, toWire(x)]),
    );
  return v;
}
export function fromValue(v: unknown): Value {
  if (v && typeof v === "object") {
    if ("$bigint" in v) return BigInt(String(v.$bigint));
    if ("$blob" in v) return Buffer.from(String(v.$blob), "base64");
  }
  return v as Value;
}
export function frame(value: unknown): Buffer {
  const b = Buffer.from(JSON.stringify(toWire(value)));
  assert(
    b.length <= MAX_MESSAGE,
    "LIMIT",
    "Response exceeds protocol limit; use LIMIT",
  );
  const h = Buffer.alloc(4);
  h.writeUInt32BE(b.length);
  return Buffer.concat([h, b]);
}
export class Decoder {
  private bytes = Buffer.alloc(0);
  push(b: Buffer): unknown[] {
    this.bytes = Buffer.concat([this.bytes, b]);
    const messages: unknown[] = [];
    while (this.bytes.length >= 4) {
      const size = this.bytes.readUInt32BE(0);
      assert(
        size > 0 && size <= MAX_MESSAGE,
        "PROTOCOL",
        "Invalid frame length",
      );
      if (this.bytes.length < 4 + size) break;
      messages.push(JSON.parse(this.bytes.subarray(4, size + 4).toString()));
      this.bytes = this.bytes.subarray(size + 4);
    }
    assert(
      this.bytes.length <= MAX_MESSAGE + 4,
      "PROTOCOL",
      "Buffered message too large",
    );
    return messages;
  }
}
