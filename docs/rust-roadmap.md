# Rust migration

Keep TypeScript as the reference implementation. First define conformance fixtures for tuple/page/WAL encodings, PageStore reads/writes/sync, process ownership and B+ tree operations. A native addon can accept byte buffers and opaque handles instead of receiving mutable JS catalogs. Batched I/O avoids per-tuple FFI calls. Keep parsing/planning in TypeScript initially.

Migrate storage/checksums first, then B+ tree pages, WAL/fsync/recovery, then execution hotspots. Preserve the same corruption/crash tests against both backends. Introduce explicit native resource lifetime and shutdown semantics before moving transaction locks. No Rust code or placeholder addon is included in this release.
