import { checksum, assert } from "../../common/src/index.ts";
export const WAL_HEADER = 24,
  MAX_IMAGE = 256 * 1024 * 1024;
export function encodeCommit(image: Buffer, lsn: number): Buffer {
  assert(image.length <= MAX_IMAGE, "LIMIT", "WAL image limit");
  const h = Buffer.alloc(WAL_HEADER);
  h.write("NXWL");
  h.writeUInt32LE(1, 4);
  h.writeUInt32LE(image.length, 8);
  h.writeUInt32LE(checksum(image), 12);
  h.writeUInt32LE(lsn, 16);
  h.writeUInt32LE(checksum(h.subarray(0, 20)), 20);
  return Buffer.concat([h, image]);
}
export interface RecoveryImage {
  image?: Buffer;
  lsn: number;
  validBytes: number;
}
export function readCommits(b: Buffer): RecoveryImage {
  let at = 0,
    lsn = 0,
    image: Buffer | undefined;
  while (at + WAL_HEADER <= b.length) {
    const h = b.subarray(at, at + WAL_HEADER);
    assert(
      h.toString("ascii", 0, 4) === "NXWL" && h.readUInt32LE(4) === 1,
      "CORRUPT",
      "WAL magic/version",
    );
    assert(
      checksum(h.subarray(0, 20)) === h.readUInt32LE(20),
      "CORRUPT",
      "WAL header checksum",
    );
    const len = h.readUInt32LE(8);
    assert(
      len <= MAX_IMAGE && len % 4096 === 0 && len > 0,
      "CORRUPT",
      "WAL length",
    );
    if (at + WAL_HEADER + len > b.length) break;
    const candidate = b.subarray(at + WAL_HEADER, at + WAL_HEADER + len);
    assert(
      checksum(candidate) === h.readUInt32LE(12),
      "CORRUPT",
      "WAL checksum",
    );
    lsn = h.readUInt32LE(16);
    image = candidate;
    at += WAL_HEADER + len;
  }
  return { image, lsn, validBytes: at };
}
