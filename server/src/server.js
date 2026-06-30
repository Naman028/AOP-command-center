import mongoose from "mongoose";
import { createApp } from "./app.js";
import { loadConfig } from "./config/env.js";

const config = loadConfig();
const app = createApp({ config });

export async function startServer({
  serverConfig = config,
  serverApp = app,
  connect = mongoose.connect,
  listen = (application, port) => application.listen(port)
} = {}) {
  try {
    await connect(serverConfig.mongoUri, { serverSelectionTimeoutMS: 5000 });
  } catch (error) {
    if (serverConfig.isProduction) {
      throw error;
    }
    process.stderr.write(`MongoDB unavailable, starting development API with seeded in-memory data: ${error.message}\n`);
  }
  return listen(serverApp, serverConfig.port);
}

if (process.env.NODE_ENV !== "test") {
  startServer().catch((error) => {
    process.stderr.write(`Server failed to start: ${error.message}\n`);
    process.exit(1);
  });
}
