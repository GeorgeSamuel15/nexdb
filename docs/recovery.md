# Recovery

Opening a database acquires its process lock before reading WAL. Recovery validates every complete header, payload checksum and page before applying the last complete committed image. A truncated final header/payload is treated as an incomplete append and removed. A checksum mismatch is corruption and stops startup; the engine does not guess past corrupt committed bytes. Replaying a complete image is idempotent.

Tests kill a separate Node process before COMMIT and at the test-only hook immediately after WAL fsync. The first discards private changes; the second recovers the complete transfer even though data-file application never began. Torn suffixes and corrupt headers/payloads are separately tested. These tests do not establish ARIES, page-level undo, power-loss guarantees or exhaustive fault tolerance. NEXDB_TEST_CRASH is a deliberate test fault-injection environment variable and must be unset for normal operation.
