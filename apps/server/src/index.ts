import { resolve } from "node:path";
import { startServer } from "./server.ts";
const server = await startServer({
  path: resolve(process.env.NEXDB_DATA ?? "data/main.ndb"),
  password: process.env.NEXDB_PASSWORD ?? "",
  port: Number(process.env.NEXDB_PORT ?? 7432),
});
console.log(
  JSON.stringify({
    level: "info",
    event: "listening",
    address: server.server.address(),
  }),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void server.close().then(() => process.exit(0));
  });
