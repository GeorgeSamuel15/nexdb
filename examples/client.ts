import { NexDB } from "../packages/client/src/index.ts";
const db = new NexDB({
  user: "admin",
  password: process.env.NEXDB_PASSWORD ?? "",
});
try {
  await db.connect();
  console.log(await db.query("SELECT * FROM users WHERE id = ?", [1n]));
} finally {
  db.close();
}
