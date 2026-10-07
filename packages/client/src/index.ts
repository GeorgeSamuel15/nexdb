import { createConnection, type Socket } from "node:net";
import { Decoder, frame, fromValue } from "../../protocol/src/index.ts";
import { type Value, type Row, NexError } from "../../common/src/index.ts";
import type { Result } from "../../executor/src/index.ts";
interface Response {
  id: number;
  ok: boolean;
  error?: { code: string; message: string };
  result?: Result;
}
export class NexDB {
  private socket?: Socket;
  private sequence = 0;
  private pending = new Map<
    number,
    {
      resolve: (v: Response) => void;
      reject: (e: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  constructor(
    private options: {
      host?: string;
      port?: number;
      user: string;
      password: string;
      database?: "main";
    },
  ) {}
  async connect() {
    const socket = createConnection({
      host: this.options.host ?? "127.0.0.1",
      port: this.options.port ?? 7432,
    });
    this.socket = socket;
    const decoder = new Decoder();
    socket.on("data", (data) => {
      try {
        for (const raw of decoder.push(data)) {
          const response = raw as Response;
          const p = this.pending.get(response.id);
          if (!p) continue;
          clearTimeout(p.timer);
          this.pending.delete(response.id);
          if (response.ok) p.resolve(response);
          else
            p.reject(
              new NexError(
                response.error?.code ?? "SERVER",
                response.error?.message ?? "Server error",
              ),
            );
        }
      } catch (e) {
        socket.destroy(e as Error);
      }
    });
    const fail = (e: Error) => {
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(e);
      }
      this.pending.clear();
    };
    socket.on("error", fail);
    socket.on("close", () =>
      fail(new NexError("CONNECTION", "Connection closed")),
    );
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    try {
      await this.send({
        type: "hello",
        version: 1,
        user: this.options.user,
        password: this.options.password,
        database: this.options.database ?? "main",
      });
    } catch (e) {
      socket.destroy();
      throw e;
    }
  }
  private send(body: Record<string, unknown>): Promise<Response> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      if (!this.socket || this.socket.destroyed) {
        reject(new NexError("CONNECTION", "Not connected"));
        return;
      }
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new NexError("TIMEOUT", "Request timed out"));
        this.socket?.destroy();
      }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.socket.write(frame({ ...body, id }));
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  async query(sql: string, params: Value[] = []): Promise<Result> {
    const response = await this.send({ type: "query", sql, params }),
      result = response.result!;
    result.rows = result.rows.map(
      (row) =>
        Object.fromEntries(
          Object.entries(row).map(([k, v]) => [k, fromValue(v)]),
        ) as Row,
    );
    return result;
  }
  close() {
    this.socket?.end();
  }
}
