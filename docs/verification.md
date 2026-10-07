# Verification record

Executed on Linux with Node.js v24.19.0 and pnpm 11.25.0 on 2026-10-05.

| Check                                    | Result                                              |
| ---------------------------------------- | --------------------------------------------------- |
| pnpm install --frozen-lockfile           | Passed                                              |
| pnpm typecheck                           | Passed, including test files                        |
| pnpm lint                                | Passed                                              |
| pnpm test                                | Passed: Vitest harness ran 20 Node tests            |
| pnpm build                               | Passed                                              |
| Compiled CLI, two separate processes     | Created/inserted, reopened, verified George row     |
| 10,000-row SQL/index restart workflow    | Passed                                              |
| SIGKILL before commit                    | No uncommitted transfer persisted                   |
| SIGKILL after WAL sync before data write | Complete committed transfer recovered               |
| WAL damage and torn suffix               | Checksum errors rejected; incomplete suffix ignored |
| TCP multi-client transaction exclusion   | Waiting client saw committed result                 |
| Disconnect during transaction            | Private changes rolled back                         |

20 Node tests cover tuple encoding, slotted pages, disk and buffer I/O, free-page reuse, dirty eviction, SQL/parser errors, randomized B+ tree behavior, catalog/index persistence, constraints/types, transactions, concurrent calls, OS process locks, protocol framing, authentication, client parameter binding, crash recovery, corruption detection and the CLI.

One illustrative benchmark run (before the final CLI-only fix and OS-lock adapter change) measured 10,000 inserted rows in one transaction at 477 ms, point lookup at 0.91 ms, full scan at 4.20 ms, one update at 333 ms and one delete at 286 ms. These single-run figures reflect full-snapshot writes on this environment. They are not comparative performance claims.

Not executed: Windows, Docker build, hosted CI, power-loss simulations, storage-device fault injection, prolonged load/security testing. The Windows CI definition is provided but its results are unknown. The implementation is a working experimental milestone, not a completed production DBMS.

## NexDB 0.2.0 verification — 2026-10-07

Executed on Linux, Node.js 24.19.0 and pnpm 11.25.0. Typechecking, lint, build and the Vitest integration harness passed (26 Node tests). Six added tests cover mixed record sizes through 16 MiB, checksum-valid malformed fragment chains, SQL text/BLOB and index persistence with rollback/update/delete, legacy inline snapshot loading, SIGKILL after WAL sync for a large row, and rejection of oversized SQL records before WAL modification. The overflow example verified 41,000 text bytes and 24,000 BLOB bytes after checkpoint and reopen.

The 16 MiB bound applies to each serialized record including metadata. TCP framing remains 1 MiB. Full snapshots, in-memory rows, and existing experimental concurrency/security limits remain. Windows and power-loss testing were not performed in this session.

## NexDB 0.2.1 verification — 2026-10-07

User-provided Windows output from v0.2.0 showed 20 passing and 6 failing tests. Failures involved pre/post-creation lock path separators, EPERM on truncating an append-mode WAL, and POSIX-only signal assertions. Fixed these paths and explicit failure cleanup. Added independent-process lock rejection and WAL appending after checkpoint/reopen/torn-tail recovery. Linux: 28 tests, typecheck, lint, build and overflow example passed. No Windows runtime was available here; Windows validation remains pending.
