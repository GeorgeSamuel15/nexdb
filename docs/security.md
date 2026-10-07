# Security model and limitations

The default server listens on loopback. A single admin password is supplied through NEXDB_PASSWORD, checked for a minimum of 12 characters, hashed with a random salt using scrypt at server startup, and compared in constant time. The server does not persist plaintext passwords. The environment variable itself remains a secret and must be protected. This is not persistent database user management or RBAC. There is no TLS; loopback only is the supported operating mode.

Zod validates discriminated requests and parameter shapes. Frame limits, SQL length/depth bounds, handshake/idle timeouts, queued-request limits and connection limits provide basic resource bounds. No eval or executable object deserialization is used. Remote clients cannot choose filesystem paths. Owners must keep data directories private. Startup emits a structured event; full query auditing, rate-limit policies and log levels are not implemented.

This is development software, not an audited secure database. Do not store sensitive production information in it.
