import { createApp } from "../server/src/app.js";
import { loadConfig } from "../server/src/config/env.js";
import { startServer } from "../server/src/server.js";

if (process.env.NODE_ENV !== "test") {
  throw new Error("E2E server must run with NODE_ENV=test");
}

if (process.env.MONGODB_URI) {
  throw new Error("E2E server refuses MONGODB_URI; use the in-memory test store only");
}

const config = loadConfig({
  NODE_ENV: "test",
  PORT: process.env.PORT ?? "4100",
  HOST: process.env.HOST ?? "127.0.0.1",
  CLIENT_ORIGINS: process.env.CLIENT_ORIGINS ?? "http://127.0.0.1:5174",
  COOKIE_SECURE: "false",
  MONGODB_URI: ""
});

const app = createApp({ config, store: { useMongo: false } });

startServer({
  serverConfig: config,
  serverApp: app,
  connect: async () => {
    throw new Error("MongoDB disabled for E2E");
  },
  syncIndexes: async () => {}
}).catch((error) => {
  process.stderr.write(`E2E server failed: ${error.message}\n`);
  process.exit(1);
});
