# Page and tuple format, version 1

All page integers are little-endian. Page size is 4096 bytes. Offsets: 0..3 ASCII NXPG; 4 uint16 version (1); 6 uint16 page kind (0 live, 1 free, 2 overflow fragment); 8 uint32 page ID; 12..15 reserved; 16 uint16 slot count; 18 uint16 lower boundary of record area; 20..23 reserved; 24 uint32 CRC32; 28..31 reserved. CRC covers the entire page with bytes 24..27 zeroed. A slot at 32 + 4*i contains uint16 record offset and uint16 record length. Zero length is a tombstone. Records grow down from the page end. Compaction retains slot numbers. Checks verify identity, checksum, directory bounds and overlapping records.

Tuple encoding begins with uint8 version 1 and uint32 value count. Each value is uint8 tag, uint32 byte length, and payload. Tags: 0 NULL (0 bytes), 1 boolean (one byte 0/1), 2 float64 LE (8), 3 signed int64 LE (8), 4 UTF-8 text, 5 raw BLOB. INT values use float64 encoding but are constrained to signed int32 by schema validation. DATE/TIMESTAMP use validated strings. Catalog records begin with a string discriminator (catalog/table/column/row/index/node). This release has no on-disk format migration utility.

## Overflow records (introduced in NexDB 0.2)

The NXPG header remains version 1. Kind 2 is a new page-kind discriminator; it contains exactly one live slot. The slot payload starts with uint32 total serialized record length and uint32 fragment byte offset, followed by up to 4052 data bytes. Total length must exceed 4060 and must not exceed 16 MiB. The first offset is zero; subsequent fragments occupy consecutive pages and advance by exactly 4052 bytes except the final fragment. Every fragment repeats the total length. A short final fragment must end exactly at that length. No ordinary page may interrupt a chain.

Readers reject unknown snapshot page kinds, offset gaps, inconsistent totals, invalid fragment sizes, and incomplete chains. Page checksums protect each fragment. WAL image validation also checks chain structure before writing the recovered image. The catalog/tuple binary encodings are unchanged. Old all-inline snapshots remain readable; v0.1 readers cannot read overflow snapshots.
