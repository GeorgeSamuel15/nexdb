import { createServer, type Socket } from "node:net";
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import { Database } from "../../../packages/executor/src/index.ts";
import {
  Decoder,
  frame,
  request,
  fromValue,
} from "../../../packages/protocol/src/index.ts";
import { parse } from "../../../packages/sql-parser/src/index.ts";
import { assert, NexError } from "../../../packages/common/src/index.ts";
import { Gate } from "../../../packages/transactions/src/index.ts";
export async function startServer(options: {
  path: string;
  password: string;
  user?: string;
  port?: number;
  host?: string;
}) {
  assert(
    options.password.length >= 12,
    "AUTH",
    "Set a password of at least 12 characters",
  );
  const db = await Database.open(options.path),
    gate = new Gate(),
    sockets = new Set<Socket>(),
    cleanups = new Set<Promise<void>>();
  const salt = randomBytes(16),
    hash = scryptSync(options.password, salt, 32);
  let stopping = false;
  const server = createServer((socket) => {
    if (stopping || sockets.size >= 100) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    const owner = {},
      decoder = new Decoder();
    let authenticated = false,
      transaction = false,
      pending = 0,
      queue = Promise.resolve();
    const authTimer = setTimeout(() => socket.destroy(), 10000);
    socket.setTimeout(30000, () => socket.destroy());
    socket.on("error", () => {});
    async function handle(raw: unknown) {
      let id = 0;
      try {
        const r = request.parse(raw);
        id = r.id;
        if (!authenticated) {
          assert(r.type === "hello", "AUTH", "Handshake required");
          assert(
            r.user === (options.user ?? "admin") &&
              timingSafeEqual(scryptSync(r.password, salt, 32), hash),
            "AUTH",
            "Invalid credentials",
          );
          authenticated = true;
          clearTimeout(authTimer);
          socket.write(frame({ id, ok: true, version: 1, database: "main" }));
          return;
        }
        assert(r.type !== "hello", "PROTOCOL", "Already authenticated");
        if (r.type === "close") {
          socket.end();
          return;
        }
        const statement = parse(r.sql);
        await gate.acquire(owner);
        if (socket.destroyed) {
          gate.release(owner);
          return;
        }
        try {
          const result = await db.query(r.sql, r.params.map(fromValue));
          if (statement.kind === "begin") transaction = true;
          if (statement.kind === "commit" || statement.kind === "rollback")
            transaction = false;
          socket.write(frame({ id, ok: true, result }));
        } finally {
          if (!transaction) gate.release(owner);
        }
      } catch (e) {
        const code = e instanceof NexError ? e.code : "REQUEST";
        if (!socket.destroyed)
          socket.write(
            frame({
              id,
              ok: false,
              error: {
                code,
                message: e instanceof Error ? e.message : "Request failed",
              },
            }),
          );
        if (!authenticated) socket.end();
      }
    }
    socket.on("data", (data) => {
      try {
        for (const raw of decoder.push(data)) {
          assert(++pending <= 32, "LIMIT", "Too many queued requests");
          queue = queue
            .then(() => handle(raw))
            .finally(() => {
              pending--;
            });
        }
      } catch {
        socket.destroy();
      }
    });
    socket.on("close", () => {
      clearTimeout(authTimer);
      const cleanup = queue
        .then(async () => {
          if (transaction) {
            await db.query("ROLLBACK");
            transaction = false;
          }
          gate.release(owner);
          sockets.delete(socket);
        })
        .catch(() => gate.release(owner));
      cleanups.add(cleanup);
      void cleanup.finally(() => cleanups.delete(cleanup));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 7432, options.host ?? "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return {
    server,
    db,
    async close() {
      stopping = true;
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      /* close listeners enqueue rollback before this microtask */ await new Promise(
        (resolve) => setImmediate(resolve),
      );
      await Promise.all(cleanups);
      await db.close();
    },
  };
}
