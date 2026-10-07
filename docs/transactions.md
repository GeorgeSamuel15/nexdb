# Transactions

Each Database instance is one embedded session. Its asynchronous operations are queued. BEGIN creates a working copy; each statement creates another candidate copy and validates it before acceptance. A failed statement discards only its candidate; earlier statements remain in the active transaction. COMMIT writes and synchronizes a redo image before touching database pages. ROLLBACK and closing the session discard its working state.

The server uses a whole-database exclusive lock per session, retained across explicit transactions and released after autocommit. A disconnected owner rolls back. There are no shared/read locks, lock upgrades, transaction IDs in SQL, MVCC versions or named isolation levels. A single lock avoids multi-lock deadlock cycles but limits concurrency. Commit I/O errors poison the embedded session because the durable outcome may be uncertain; close and reopen for recovery.
