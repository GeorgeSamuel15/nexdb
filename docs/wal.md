# WAL format, version 1

A committed snapshot record is a 24-byte header followed by complete 4096-byte pages. Header: ASCII NXWL at 0; uint32 LE version 1 at 4; uint32 image length at 8; uint32 image CRC32 at 12; uint32 generation/LSN at 16; uint32 CRC32 of header bytes 0..19 at 20. Maximum image is 256 MiB. A complete, valid frame is the commit record. There are no per-row BEGIN/UPDATE/ABORT records in this version. Generation resets after checkpoint/reopen; it is not a globally monotonic transaction ID.

Commit: build/validate image, append frame, fsync WAL, write image, truncate data file to image length, fsync data. No uncommitted pages reach the data file (no-steal). Checkpoint: fsync data, truncate WAL, fsync WAL. Keep both files for recovery. Commit outcomes can be uncertain to a disconnected client; no automatic query retries are performed.
