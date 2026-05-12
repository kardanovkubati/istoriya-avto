import app from "./app";
import { env } from "./env";

Bun.serve({
  port: env.PORT,
  fetch: app.fetch
});

console.log(`История Авто API listening on ${env.PORT}`);
