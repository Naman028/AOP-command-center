import { pathToFileURL } from "node:url";
import mongoose from "mongoose";
import { createApp } from "./app.js";
import { loadConfig } from "./config/env.js";
import { FinancialYear } from "./models/FinancialYear.js";
import { Material } from "./models/Material.js";
import { Plant } from "./models/Plant.js";

const config = loadConfig();

export async function syncMasterDataIndexes() {
  await Promise.all([
    Plant.syncIndexes(),
    Material.syncIndexes(),
    FinancialYear.syncIndexes()
  ]);
}

export async function startServer({
  serverConfig = config,
  serverApp,
  connect = mongoose.connect,
  listen = (application, port) => application.listen(port),
  syncIndexes = syncMasterDataIndexes
} = {}) {
  let useMongo = false;
  try {
    if (!serverConfig.mongoUri) {
      throw new Error("MONGODB_URI is required");
    }
    await connect(serverConfig.mongoUri, { serverSelectionTimeoutMS: 5000 });
    await syncIndexes();
    useMongo = true;
  } catch (error) {
    if (serverConfig.isProduction) {
      throw error;
    }
    process.stderr.write(`MongoDB unavailable, starting development API with seeded in-memory data: ${error.message}\n`);
  }
  const application = serverApp ?? createApp({ config: serverConfig, store: { useMongo } });
  return listen(application, serverConfig.port);
}

if (process.env.NODE_ENV !== "test" && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().catch((error) => {
    process.stderr.write(`Server failed to start: ${error.message}\n`);
    process.exit(1);
  });
}
