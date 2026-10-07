# Status against the original specification

| Subsystem        | Delivered                                                       | Remaining                                               |
| ---------------- | --------------------------------------------------------------- | ------------------------------------------------------- |
| Architecture     | pnpm packages, strict TS, build/lint/test, CI definition        | npm publication and wider platform verification         |
| Storage          | Binary pages, overflow records, tuples, checksums, persisted free tracking        | Incremental SQL heap writes             |
| Buffer pool      | LRU, pins, dirty writes, counters, startup use                  | Query-time page-backed rows                             |
| Catalog          | Binary table/column/index records, object IDs                   | Catalog SQL views, schema evolution, multiple databases |
| Parser           | Typed SQL subset, expressions and errors                        | ALTER, joins, grouping and broader SQL                  |
| Planner/executor | Equality index plan, iterator selection pipeline                | Cost model, aggregates/joins, spill and ANALYZE         |
| B+ tree          | Split, root growth, point/range, duplicates, binary persistence | Local merge/redistribution and page-granular updates    |
| Constraints      | PK, UNIQUE, NOT NULL, DEFAULT                                   | FK, CHECK, composite constraints                        |
| Transactions     | Working copies, commit/rollback, statement atomicity            | Transaction metadata and fine-grained locks             |
| WAL/recovery     | Durable checksummed snapshot redo, checkpoint, SIGKILL tests    | Page WAL, undo/CLRs, exhaustive fault matrix            |
| Concurrency      | Serial server sessions, lock timeout, disconnect rollback       | Shared/exclusive lock table, MVCC                       |
| TCP/SDK          | Framing, handshake, parameterized SQL, result/error responses   | Prepared handles, cancellation, multiple databases      |
| Authentication   | Single scrypt-verified admin                                    | Persistent users, permissions, TLS                      |
| CLI              | Local shell, multiline SQL, schema/index commands, timing       | Database switching and persistent history               |
| Metrics          | Query/transaction counters, startup buffer statistics           | Running queries, WAL/storage metrics, structured audits |
| Studio           | Deferred                                                        | Entire optional UI                                      |
| Benchmarks       | Inserts, scans, indexed select, update/delete                   | Random workloads, commit/recovery matrices              |
| Rust             | Interface and migration documentation                           | Native implementation, intentionally deferred           |

The first SQL persistence milestone and the basic transfer/rollback milestone are implemented and tested. This table intentionally does not mark all requested phases complete. Subsequent work must preserve the verified persistence and crash tests.
