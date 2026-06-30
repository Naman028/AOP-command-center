import assert from "node:assert/strict";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../server/src/app.js";
import { loadConfig } from "../server/src/config/env.js";
import { FinancialYear } from "../server/src/models/FinancialYear.js";
import { Material } from "../server/src/models/Material.js";
import { Plant } from "../server/src/models/Plant.js";
import { startServer } from "../server/src/server.js";

const origin = process.env.CLIENT_ORIGINS?.split(",")[0] ?? "http://localhost:5173";

function requireMongoUri() {
  if (!process.env.MONGODB_URI) {
    throw new Error("Set MONGODB_URI to a real MongoDB/Atlas database before running this gate.");
  }
}

async function login(application) {
  const response = await request(application)
    .post("/api/auth/login")
    .set("Origin", origin)
    .send({ email: "admin@aop.local", password: "Password123!" });

  assert.equal(response.status, 200, response.text);
  const cookies = response.headers["set-cookie"];
  const csrfCookie = cookies.find((cookie) => cookie.startsWith("csrfToken="));
  assert.ok(csrfCookie, "csrfToken cookie was not set");

  return {
    cookies,
    csrf: decodeURIComponent(csrfCookie.split(";")[0].split("=")[1])
  };
}

async function startGateApp() {
  const config = loadConfig({
    NODE_ENV: "development",
    CLIENT_ORIGINS: origin,
    COOKIE_SECURE: "false",
    MONGODB_URI: process.env.MONGODB_URI
  });

  const app = createApp({ config, store: { useMongo: true } });
  const server = await startServer({
    serverConfig: config,
    serverApp: app,
    listen: (application) => application.listen(0)
  });

  return { app, server };
}

async function closeGateApp(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  await mongoose.disconnect();
}

async function verifyIndexes() {
  const [plantIndexes, materialIndexes, financialYearIndexes] = await Promise.all([
    Plant.collection.indexes(),
    Material.collection.indexes(),
    FinancialYear.collection.indexes()
  ]);

  assert.ok(plantIndexes.some((index) => index.key.code === 1 && index.unique), "Plant code unique index missing");
  assert.ok(materialIndexes.some((index) => index.key.code === 1 && index.unique), "Material code unique index missing");
  assert.ok(financialYearIndexes.some((index) => index.key.label === 1 && index.unique), "FinancialYear label unique index missing");
  assert.ok(financialYearIndexes.some((index) => index.key.isActive === 1 && index.unique && index.partialFilterExpression?.isActive === true), "FinancialYear active partial unique index missing");
}

async function verifyProductionFailsClosed() {
  await assert.rejects(
    startServer({
      serverConfig: loadConfig({ NODE_ENV: "production", MONGODB_URI: "" }),
      serverApp: {},
      connect: async () => {
        throw new Error("connect should not be called without MONGODB_URI");
      },
      listen: () => {
        throw new Error("listen should not be called without MONGODB_URI");
      }
    }),
    /MONGODB_URI is required/
  );
}

async function run() {
  requireMongoUri();

  const code = `GATE-${Date.now()}`;
  const plantPayload = {
    name: "Mongo Persistence Gate Plant",
    code,
    location: "Gate Test",
    businessUnit: "QA",
    isActive: true
  };

  let gate = await startGateApp();
  const auth = await login(gate.app);
  const created = await request(gate.app)
    .post("/api/master-data/plants")
    .set("Origin", origin)
    .set("X-CSRF-Token", auth.csrf)
    .set("Cookie", auth.cookies)
    .send(plantPayload);

  assert.equal(created.status, 201, created.text);
  assert.equal(created.body.plant.code, code);
  process.stdout.write("✓ Plant created through the API\n");
  await closeGateApp(gate.server);
  process.stdout.write("✓ Backend restarted\n");

  gate = await startGateApp();
  const restartedAuth = await login(gate.app);
  const list = await request(gate.app)
    .get(`/api/master-data/plants?search=${encodeURIComponent(code)}`)
    .set("Cookie", restartedAuth.cookies);

  assert.equal(list.status, 200, list.text);
  assert.ok(list.body.rows.some((plant) => plant.code === code), "Created plant did not persist after backend restart");
  process.stdout.write("✓ Same Plant still exists after restart\n");

  await verifyIndexes();
  process.stdout.write("✓ Master-data indexes exist in MongoDB\n");
  await closeGateApp(gate.server);
  await verifyProductionFailsClosed();
  process.stdout.write("✓ Production mode without MONGODB_URI fails closed\n");

  process.stdout.write(`MongoDB persistence gate passed for plant ${code}\n`);
}

run().catch(async (error) => {
  await mongoose.disconnect().catch(() => {});
  process.stderr.write(`MongoDB persistence gate failed: ${error.message}\n`);
  process.exit(1);
});
