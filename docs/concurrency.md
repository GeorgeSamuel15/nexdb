# Concurrency and process ownership

Server requests on one socket execute in order. A FIFO gate grants one session exclusive engine access. Explicit transactions retain ownership; other clients wait up to five seconds. Socket closure queues rollback and release after outstanding work. The embedded engine queues direct asynchronous calls but has only one transaction context.

Linux ownership uses util-linux flock on an inherited file descriptor; the parent retains the shared open-file description until close or process death. The .lock file may remain on disk but is not evidence of a live lock. Windows uses a named pipe derived from the canonical database path. Both mechanisms are intended to release ownership on process exit without deleting lock files. Only the Linux adapter was exercised here. Network filesystems, multiple containers with separate lock namespaces, hardlink aliases and macOS are not supported deployment configurations.
