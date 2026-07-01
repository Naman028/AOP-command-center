import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../server/src/app.js";
import { loadConfig } from "../server/src/config/env.js";
import { Actual } from "../server/src/models/Actual.js";
import { AuditLog } from "../server/src/models/AuditLog.js";
import { FinancialYear } from "../server/src/models/FinancialYear.js";
import { Material } from "../server/src/models/Material.js";
import { Plant } from "../server/src/models/Plant.js";
import { Target } from "../server/src/models/Target.js";
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
  const [plantIndexes, materialIndexes, financialYearIndexes, targetIndexes, actualIndexes, auditIndexes] = await Promise.all([
    Plant.collection.indexes(),
    Material.collection.indexes(),
    FinancialYear.collection.indexes(),
    Target.collection.indexes(),
    Actual.collection.indexes(),
    AuditLog.collection.indexes()
  ]);

  assert.ok(plantIndexes.some((index) => index.key.code === 1 && index.unique), "Plant code unique index missing");
  assert.ok(materialIndexes.some((index) => index.key.code === 1 && index.unique), "Material code unique index missing");
  assert.ok(financialYearIndexes.some((index) => index.key.label === 1 && index.unique), "FinancialYear label unique index missing");
  assert.ok(financialYearIndexes.some((index) => index.key.isActive === 1 && index.unique && index.partialFilterExpression?.isActive === true), "FinancialYear active partial unique index missing");
  assert.ok(targetIndexes.some((index) => index.key.plant === 1 && index.key.financialYear === 1 && index.key.month === 1 && index.key.metricType === 1 && index.key.category === 1 && index.key.material === 1 && index.unique), "Target compound unique index missing");
  assert.ok(actualIndexes.some((index) => index.key.plant === 1 && index.key.financialYear === 1 && index.key.month === 1 && index.key.metricType === 1 && index.key.category === 1 && index.key.material === 1 && index.unique), "Actual compound unique index missing");
  assert.ok(auditIndexes.some((index) => index.key.actorUserId === 1 && index.key.createdAt === -1), "Audit actor/date index missing");
  assert.ok(auditIndexes.some((index) => index.key.entityType === 1 && index.key.entityId === 1), "Audit entity index missing");
  assert.ok(auditIndexes.some((index) => index.key.action === 1 && index.key.createdAt === -1), "Audit action/date index missing");
  assert.ok(auditIndexes.some((index) => index.key.plantId === 1 && index.key.createdAt === -1), "Audit plant/date index missing");
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

  let financialYear = await FinancialYear.findOne({ isActive: true }).lean();
  if (!financialYear) {
    financialYear = (await FinancialYear.create({
      label: `GATE-${Date.now()}`,
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
      isActive: true,
      createdBy: "000000000000000000000001",
      updatedBy: "000000000000000000000001"
    })).toObject();
  }

  const target = await request(gate.app)
    .post("/api/targets")
    .set("Origin", origin)
    .set("X-CSRF-Token", auth.csrf)
    .set("Cookie", auth.cookies)
    .send({
      plant: created.body.plant.id,
      financialYear: String(financialYear._id),
      month: 1,
      metricType: "TURNOVER",
      category: code,
      plannedValue: 1,
      unit: "USD",
      notes: "Mongo gate"
    });

  assert.equal(target.status, 201, target.text);

  const actual = await request(gate.app)
    .post("/api/actuals")
    .set("Origin", origin)
    .set("X-CSRF-Token", auth.csrf)
    .set("Cookie", auth.cookies)
    .send({
      plant: created.body.plant.id,
      financialYear: String(financialYear._id),
      month: 2,
      metricType: "TURNOVER",
      category: code,
      actualValue: 1,
      unit: "USD",
      source: "MANUAL",
      notes: "Mongo gate"
    });

  assert.equal(actual.status, 201, actual.text);
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

  const targetList = await request(gate.app)
    .get(`/api/targets?plant=${encodeURIComponent(created.body.plant.id)}&category=${encodeURIComponent(code)}`)
    .set("Cookie", restartedAuth.cookies);

  assert.equal(targetList.status, 200, targetList.text);
  assert.ok(targetList.body.rows.some((row) => row.category === code), "Created target did not persist through MongoDB");

  const actualList = await request(gate.app)
    .get(`/api/actuals?plant=${encodeURIComponent(created.body.plant.id)}&category=${encodeURIComponent(code)}`)
    .set("Cookie", restartedAuth.cookies);

  assert.equal(actualList.status, 200, actualList.text);
  assert.ok(actualList.body.rows.some((row) => row.category === code), "Created actual did not persist through MongoDB");
  process.stdout.write("✓ Actual record persists after restart\n");

  const auditLogs = await request(gate.app)
    .get(`/api/audit-logs?action=CREATE_TARGET&entityType=Target&plantId=${encodeURIComponent(code)}`)
    .set("Cookie", restartedAuth.cookies);

  assert.equal(auditLogs.status, 200, auditLogs.text);
  assert.ok(auditLogs.body.rows.some((row) => row.action === "CREATE_TARGET"), "Target audit record did not persist after backend restart");
  process.stdout.write("✓ Audit records persist after restart\n");

  const fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), "aop-gate-import-"));
  const importPath = path.join(fixtureDir, "actual-import.csv");
  await fs.writeFile(importPath, `plantCode,financialYearLabel,month,metricType,category,materialCode,actualValue,unit,notes\n${code},${financialYear.label},3,TURNOVER,${code},,5,USD,gate\n`);
  const importPreview = await request(gate.app)
    .post("/api/imports/preview")
    .set("Origin", origin)
    .set("X-CSRF-Token", restartedAuth.csrf)
    .set("Cookie", restartedAuth.cookies)
    .attach("file", importPath);

  assert.equal(importPreview.status, 201, importPreview.text);
  assert.equal(importPreview.body.batch.validRows, 1);
  process.stdout.write("✓ Import preview creates a staged batch\n");

  const importConfirm = await request(gate.app)
    .post(`/api/imports/${importPreview.body.batch.id}/confirm`)
    .set("Origin", origin)
    .set("X-CSRF-Token", restartedAuth.csrf)
    .set("Cookie", restartedAuth.cookies);

  if (importPreview.body.transactionAvailable) {
    assert.equal(importConfirm.status, 200, importConfirm.text);
    process.stdout.write("✓ Transaction-capable import confirmation succeeds\n");
  } else {
    assert.equal(importConfirm.status, 409, importConfirm.text);
    assert.equal(importConfirm.body.error.code, "TRANSACTIONAL_IMPORT_REQUIRED");
    process.stdout.write("✓ Transaction-unavailable import confirmation fails closed\n");
  }
  await fs.rm(fixtureDir, { recursive: true, force: true });

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
