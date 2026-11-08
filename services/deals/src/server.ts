import { config, required } from "./config.js";
import { poolFor } from "./db.js";
import { buildApp } from "./app.js";
required(config.DEALS_AUTH_SECRET, "DEALS_AUTH_SECRET");
const pool = poolFor(required(config.DATABASE_URL, "DATABASE_URL"));
const app = await buildApp(pool, config, true);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, async () => {
    await app.close();
    await pool.end();
  });
await app.listen({ host: config.HOST, port: config.PORT });
