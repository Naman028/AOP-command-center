import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { startServer } from "../server.js";

function app(config = {}) {
  return createApp({
    config: {
      NODE_ENV: "test",
      CLIENT_ORIGINS: "http://localhost:5173",
      COOKIE_SECURE: "false",
      BCRYPT_WORK_FACTOR: "12",
      ...config
    }
  });
}

async function login(application, email) {
  const response = await request(application)
    .post("/api/auth/login")
    .set("Origin", "http://localhost:5173")
    .send({ email, password: "Password123!" });
  const cookies = response.headers["set-cookie"];
  const csrf = cookies.find((cookie) => cookie.startsWith("csrfToken=")).split(";")[0].split("=")[1];
  return { cookies, csrf: decodeURIComponent(csrf), body: response.body };
}

function targetPayload(overrides = {}) {
  return {
    plant: "100000000000000000000001",
    financialYear: "300000000000000000000001",
    month: 2,
    metricType: "EXPENSE",
    category: "TOTAL",
    plannedValue: 10,
    unit: "USD",
    notes: "",
    ...overrides
  };
}

function actualPayload(overrides = {}) {
  return {
    plant: "100000000000000000000001",
    financialYear: "300000000000000000000001",
    month: 2,
    metricType: "EXPENSE",
    category: "TOTAL",
    actualValue: 10,
    unit: "USD",
    source: "MANUAL",
    notes: "",
    ...overrides
  };
}

describe("security architecture", () => {
  it("fails closed in production when MongoDB is unavailable", async () => {
    const listen = vi.fn();
    await expect(startServer({
      serverConfig: { isProduction: true, mongoUri: "mongodb://unavailable", port: 0 },
      serverApp: {},
      connect: async () => {
        throw new Error("database unavailable");
      },
      listen
    })).rejects.toThrow("database unavailable");
    expect(listen).not.toHaveBeenCalled();
  });

  it("enables exact CORS credentials only for allowed origins and production secure cookies", async () => {
    const application = app({
      NODE_ENV: "production",
      CLIENT_ORIGINS: "https://app.example.com",
      COOKIE_SECURE: "true"
    });

    const allowed = await request(application)
      .post("/api/auth/login")
      .set("Origin", "https://app.example.com")
      .set("X-Forwarded-Proto", "https")
      .send({ email: "admin@aop.local", password: "Password123!" });
    expect(allowed.status).toBe(200);
    expect(allowed.headers["access-control-allow-origin"]).toBe("https://app.example.com");
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");
    expect(allowed.headers["set-cookie"].some((cookie) => cookie.startsWith("accessToken=") && cookie.includes("Secure"))).toBe(true);

    const blocked = await request(application)
      .post("/api/auth/login")
      .set("Origin", "https://evil.example.com")
      .set("X-Forwarded-Proto", "https")
      .send({ email: "admin@aop.local", password: "Password123!" });
    expect(blocked.status).toBe(403);
    expect(blocked.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("uses generic login failures and stores no plaintext passwords", async () => {
    const application = app();
    const response = await request(application)
      .post("/api/auth/login")
      .set("Origin", "http://localhost:5173")
      .send({ email: "admin@aop.local", password: "wrong" });

    expect(response.status).toBe(401);
    expect(response.body.error.message).toBe("Invalid email or password");
    expect(application.locals.store.users[0].passwordHash).not.toBe("Password123!");
    expect(application.locals.store.users[0].passwordHash.startsWith("$2")).toBe(true);
  });

  it("blocks inactive users with the same generic login error", async () => {
    const application = app();
    const response = await request(application)
      .post("/api/auth/login")
      .set("Origin", "http://localhost:5173")
      .send({ email: "inactive@aop.local", password: "Password123!" });

    expect(response.status).toBe(401);
    expect(response.body.error.message).toBe("Invalid email or password");
  });

  it("sets HttpOnly cookies, validates /me, rotates refresh tokens, and revokes logout", async () => {
    const application = app();
    const auth = await login(application, "admin@aop.local");

    expect(auth.cookies.some((cookie) => cookie.startsWith("accessToken=") && cookie.includes("HttpOnly"))).toBe(true);
    expect(auth.cookies.some((cookie) => cookie.startsWith("refreshToken=") && cookie.includes("HttpOnly"))).toBe(true);

    const me = await request(application).get("/api/auth/me").set("Cookie", auth.cookies);
    expect(me.status).toBe(200);
    expect(me.body.user.role).toBe("ADMIN");

    const refresh = await request(application)
      .post("/api/auth/refresh")
      .set("Origin", "http://localhost:5173")
      .set("Cookie", auth.cookies);
    expect(refresh.status).toBe(200);
    expect(application.locals.store.sessions.filter((session) => session.revokedAt).length).toBe(1);

    const newCookies = refresh.headers["set-cookie"];
    const newCsrf = decodeURIComponent(newCookies.find((cookie) => cookie.startsWith("csrfToken=")).split(";")[0].split("=")[1]);
    const logout = await request(application)
      .post("/api/auth/logout")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", newCsrf)
      .set("Cookie", newCookies);
    expect(logout.status).toBe(200);
    expect(application.locals.store.sessions.every((session) => session.revokedAt)).toBe(true);
    const oldAccess = await request(application).get("/api/auth/me").set("Cookie", newCookies);
    expect(oldAccess.status).toBe(401);
    const rotatedRefreshReuse = await request(application)
      .post("/api/auth/refresh")
      .set("Origin", "http://localhost:5173")
      .set("Cookie", auth.cookies);
    expect(rotatedRefreshReuse.status).toBe(401);
    const loggedOutRefreshReuse = await request(application)
      .post("/api/auth/refresh")
      .set("Origin", "http://localhost:5173")
      .set("Cookie", newCookies);
    expect(loggedOutRefreshReuse.status).toBe(401);
  });

  it("revokes active sessions on password, role, and deactivation changes", async () => {
    const application = app();
    const staff = await login(application, "staff@aop.local");
    const passwordChange = await request(application)
      .post("/api/auth/change-password")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", staff.csrf)
      .set("Cookie", staff.cookies)
      .send({ currentPassword: "Password123!", newPassword: "NewPassword123!" });
    expect(passwordChange.status).toBe(200);
    expect(await request(application).get("/api/auth/me").set("Cookie", staff.cookies)).toMatchObject({ status: 401 });

    const lead = await login(application, "lead-a@aop.local");
    const admin = await login(application, "admin@aop.local");
    const roleChange = await request(application)
      .patch("/api/users/000000000000000000000003")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", admin.csrf)
      .set("Cookie", admin.cookies)
      .send({ role: "STAFF" });
    expect(roleChange.status).toBe(200);
    expect(await request(application).get("/api/auth/me").set("Cookie", lead.cookies)).toMatchObject({ status: 401 });

    const manager = await login(application, "manager@aop.local");
    const deactivate = await request(application)
      .patch("/api/users/000000000000000000000002")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", admin.csrf)
      .set("Cookie", admin.cookies)
      .send({ isActive: false });
    expect(deactivate.status).toBe(200);
    expect(await request(application).get("/api/auth/me").set("Cookie", manager.cookies)).toMatchObject({ status: 401 });
  });

  it("returns 401 for missing auth and 403 for authenticated forbidden access", async () => {
    const application = app();
    const anonymous = await request(application).get("/api/users");
    expect(anonymous.status).toBe(401);

    const staff = await login(application, "staff@aop.local");
    const forbidden = await request(application).get("/api/users").set("Cookie", staff.cookies);
    expect(forbidden.status).toBe(403);

    const staffAudit = await request(application).get("/api/audit-logs").set("Cookie", staff.cookies);
    expect(staffAudit.status).toBe(403);

    const manager = await login(application, "manager@aop.local");
    const managerUsers = await request(application).get("/api/users").set("Cookie", manager.cookies);
    expect(managerUsers.status).toBe(403);
    const managerAudit = await request(application).get("/api/audit-logs").set("Cookie", manager.cookies);
    expect(managerAudit.status).toBe(403);

    const lead = await login(application, "lead-a@aop.local");
    const leadAudit = await request(application).get("/api/audit-logs").set("Cookie", lead.cookies);
    expect(leadAudit.status).toBe(403);
  });

  it("enforces server-side plant scope and rejects frontend-supplied unsafe operators", async () => {
    const application = app();
    const lead = await login(application, "lead-a@aop.local");

    const report = await request(application).get("/api/reports/target-data?financialYear=300000000000000000000001").set("Cookie", lead.cookies);
    expect(report.status).toBe(200);
    expect(report.body.rows.every((row) => row.plant.code === "PLANT-A")).toBe(true);

    const plantBReport = await request(application)
      .get("/api/reports/target-data?financialYear=300000000000000000000001&plant=100000000000000000000002")
      .set("Cookie", lead.cookies);
    expect(plantBReport.status).toBe(200);
    expect(plantBReport.body.rows).toHaveLength(0);

    const forbiddenPlant = await request(application)
      .post("/api/targets")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", lead.csrf)
      .set("Cookie", lead.cookies)
      .send(targetPayload({ plant: "100000000000000000000002" }));
    expect(forbiddenPlant.status).toBe(403);

    const otherPlantTarget = application.locals.store.targets.find((target) => target.plant.code === "PLANT-B");
    const guessedRead = await request(application)
      .get(`/api/targets/${otherPlantTarget.id}`)
      .set("Cookie", lead.cookies);
    expect(guessedRead.status).toBe(403);

    const guessedEdit = await request(application)
      .patch(`/api/targets/${otherPlantTarget.id}`)
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", lead.csrf)
      .set("Cookie", lead.cookies)
      .send(targetPayload({ plant: "100000000000000000000002", plannedValue: 999 }));
    expect(guessedEdit.status).toBe(403);
    expect(application.locals.store.targets.find((target) => target.id === otherPlantTarget.id).plannedValue).toBe(200);

    const guessedStatus = await request(application)
      .patch(`/api/targets/${otherPlantTarget.id}/status`)
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", lead.csrf)
      .set("Cookie", lead.cookies)
      .send({ isActive: false });
    expect(guessedStatus.status).toBe(403);
    expect(application.locals.store.targets.some((target) => target.id === otherPlantTarget.id)).toBe(true);

    const otherPlantActual = application.locals.store.actuals.find((actual) => actual.plant.code === "PLANT-B");
    const guessedActualRead = await request(application)
      .get(`/api/actuals/${otherPlantActual.id}`)
      .set("Cookie", lead.cookies);
    expect(guessedActualRead.status).toBe(403);

    const guessedActualStatus = await request(application)
      .patch(`/api/actuals/${otherPlantActual.id}/status`)
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", lead.csrf)
      .set("Cookie", lead.cookies)
      .send({ isActive: false });
    expect(guessedActualStatus.status).toBe(403);

    const unsafe = await request(application)
      .post("/api/targets")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", lead.csrf)
      .set("Cookie", lead.cookies)
      .send(targetPayload({ plant: { $ne: "100000000000000000000001" } }));
    expect(unsafe.status).toBe(400);
  });

  it("requires allowed Origin and CSRF for state changes and applies no-store to sensitive responses", async () => {
    const application = app();
    const manager = await login(application, "manager@aop.local");
    const missingOrigin = await request(application)
      .post("/api/targets")
      .set("X-CSRF-Token", manager.csrf)
      .set("Cookie", manager.cookies)
      .send({ plantId: "PLANT-A", financialYear: "2027", metricType: "output", value: 50 });
    expect(missingOrigin.status).toBe(403);

    const missingCsrf = await request(application)
      .post("/api/targets")
      .set("Origin", "http://localhost:5173")
      .set("Cookie", manager.cookies)
      .send({ plantId: "PLANT-A", financialYear: "2027", metricType: "output", value: 50 });
    expect(missingCsrf.status).toBe(403);

    const actualWithoutCsrf = await request(application)
      .post("/api/actuals")
      .set("Origin", "http://localhost:5173")
      .set("Cookie", manager.cookies)
      .send(actualPayload());
    expect(actualWithoutCsrf.status).toBe(403);

    const userPatchWithoutCsrf = await request(application)
      .patch("/api/users/000000000000000000000004")
      .set("Origin", "http://localhost:5173")
      .set("Cookie", manager.cookies)
      .send({ role: "STAFF" });
    expect(userPatchWithoutCsrf.status).toBe(403);

    const report = await request(application).get("/api/reports/summary?financialYear=300000000000000000000001").set("Cookie", manager.cookies);
    expect(report.headers["cache-control"]).toBe("no-store");
  });

  it("rejects unsupported, oversized, malformed, and unauthorized imports with cleanup", async () => {
    const application = app();
    const manager = await login(application, "manager@aop.local");
    const fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), "aop-import-"));
    const csvPath = path.join(fixtureDir, "import.csv");
    const macroPath = path.join(fixtureDir, "macro.xlsm");
    const exePath = path.join(fixtureDir, "payload.exe");
    const malformedXlsxPath = path.join(fixtureDir, "malformed.xlsx");
    const tooManyRowsPath = path.join(fixtureDir, "too-many.csv");
    await fs.writeFile(csvPath, "plantCode,financialYearLabel,month,metricType,category,materialCode,actualValue,unit,notes\nPLANT-A,2026,7,TURNOVER,TOTAL,,10,USD,\nPLANT-B,2026,7,TURNOVER,TOTAL,,20,USD,\n");
    await fs.writeFile(tooManyRowsPath, `plantCode,financialYearLabel,month,metricType,category,materialCode,actualValue,unit,notes\n${Array.from({ length: 2001 }, () => "PLANT-A,2026,7,TURNOVER,TOTAL,,10,USD,").join("\n")}`);
    await fs.writeFile(macroPath, "macro");
    await fs.writeFile(exePath, "MZ");
    await fs.writeFile(malformedXlsxPath, "not-a-zip");

    const macro = await request(application)
      .post("/api/imports/preview")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", manager.csrf)
      .set("Cookie", manager.cookies)
      .attach("file", macroPath);
    expect(macro.status).toBe(400);

    const exe = await request(application)
      .post("/api/imports/preview")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", manager.csrf)
      .set("Cookie", manager.cookies)
      .attach("file", exePath);
    expect(exe.status).toBe(400);

    const malformed = await request(application)
      .post("/api/imports/preview")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", manager.csrf)
      .set("Cookie", manager.cookies)
      .attach("file", malformedXlsxPath);
    expect(malformed.status).toBe(400);

    const oversizedApp = app({ UPLOAD_MAX_BYTES: "8" });
    const oversizedAuth = await login(oversizedApp, "manager@aop.local");
    const oversized = await request(oversizedApp)
      .post("/api/imports/preview")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", oversizedAuth.csrf)
      .set("Cookie", oversizedAuth.cookies)
      .attach("file", csvPath);
    expect(oversized.status).toBe(413);

    const tooManyRows = await request(application)
      .post("/api/imports/preview")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", manager.csrf)
      .set("Cookie", manager.cookies)
      .attach("file", tooManyRowsPath);
    expect(tooManyRows.status).toBe(400);

    const lead = await login(application, "lead-a@aop.local");
    const preview = await request(application)
      .post("/api/imports/preview")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", lead.csrf)
      .set("Cookie", lead.cookies)
      .attach("file", csvPath);
    expect(preview.status).toBe(201);
    expect(preview.body.rows.errors[0].errors).toContain("plant is outside assigned scope");

    const confirm = await request(application)
      .post(`/api/imports/${preview.body.batch.id}/confirm`)
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", lead.csrf)
      .set("Cookie", lead.cookies);
    expect(confirm.status).toBe(400);
    await fs.rm(fixtureDir, { recursive: true, force: true });
  });

  it("escapes formula-like values in exports and audits authorization failures", async () => {
    const application = app();
    application.locals.store.targets.push({
      ...application.locals.store.targets[0],
      id: "400000000000000000000099",
      category: "FORMULA",
      plannedValue: "=SUM(1,1)"
    });
    const manager = await login(application, "manager@aop.local");
    const exportResponse = await request(application).get("/api/reports/export").set("Cookie", manager.cookies);
    expect(exportResponse.text).toContain("'=SUM(1,1)");

    const lead = await login(application, "lead-a@aop.local");
    const leadExport = await request(application).get("/api/reports/export").set("Cookie", lead.cookies);
    expect(leadExport.text).not.toContain("PLANT-B");

    const staff = await login(application, "staff@aop.local");
    await request(application).get("/api/users").set("Cookie", staff.cookies);
    expect(application.locals.store.auditLogs.some((entry) => entry.action === "ACCESS_DENIED")).toBe(true);
  });

  it("blocks duplicate target and actual insertion and rejects invalid API input safely", async () => {
    const application = app();
    const manager = await login(application, "manager@aop.local");
    const payload = targetPayload({ month: 3, metricType: "EXPENSE", plannedValue: 10 });
    const [first, second] = await Promise.all([
      request(application)
        .post("/api/targets")
        .set("Origin", "http://localhost:5173")
        .set("X-CSRF-Token", manager.csrf)
        .set("Cookie", manager.cookies)
        .send(payload),
      request(application)
        .post("/api/targets")
        .set("Origin", "http://localhost:5173")
        .set("X-CSRF-Token", manager.csrf)
        .set("Cookie", manager.cookies)
        .send(payload)
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);

    const actualBody = actualPayload({ month: 3, metricType: "EXPENSE", actualValue: 10 });
    const [actualFirst, actualSecond] = await Promise.all([
      request(application)
        .post("/api/actuals")
        .set("Origin", "http://localhost:5173")
        .set("X-CSRF-Token", manager.csrf)
        .set("Cookie", manager.cookies)
        .send(actualBody),
      request(application)
        .post("/api/actuals")
        .set("Origin", "http://localhost:5173")
        .set("X-CSRF-Token", manager.csrf)
        .set("Cookie", manager.cookies)
        .send(actualBody)
    ]);
    expect([actualFirst.status, actualSecond.status].sort()).toEqual([201, 409]);

    const invalid = await request(application)
      .post("/api/targets")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", manager.csrf)
      .set("Cookie", manager.cookies)
      .send(targetPayload({ financialYear: "bad" }));
    expect(invalid.status).toBe(400);

    const unexpectedField = await request(application)
      .post("/api/targets")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", manager.csrf)
      .set("Cookie", manager.cookies)
      .send(targetPayload({ role: "ADMIN" }));
    expect(unexpectedField.status).toBe(400);

    const invalidMonth = await request(application)
      .post("/api/targets")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", manager.csrf)
      .set("Cookie", manager.cookies)
      .send(targetPayload({ month: 13 }));
    expect(invalidMonth.status).toBe(400);

    const invalidValue = await request(application)
      .post("/api/targets")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", manager.csrf)
      .set("Cookie", manager.cookies)
      .send(targetPayload({ plannedValue: -1 }));
    expect(invalidValue.status).toBe(400);

    const invalidSort = await request(application)
      .get("/api/reports/summary?financialYear=300000000000000000000001&sort=passwordHash")
      .set("Cookie", manager.cookies);
    expect(invalidSort.status).toBe(400);

    const invalidPagination = await request(application)
      .get("/api/reports/summary?financialYear=300000000000000000000001&page=0&limit=1000")
      .set("Cookie", manager.cookies);
    expect(invalidPagination.status).toBe(400);

    const missingFinancialYear = await request(application)
      .get("/api/reports/target-data")
      .set("Cookie", manager.cookies);
    expect(missingFinancialYear.status).toBe(400);

    const invalidReportObjectId = await request(application)
      .get("/api/reports/target-data?financialYear=not-an-id")
      .set("Cookie", manager.cookies);
    expect(invalidReportObjectId.status).toBe(400);

    const invalidTargetSort = await request(application)
      .get("/api/targets?sort=passwordHash")
      .set("Cookie", manager.cookies);
    expect(invalidTargetSort.status).toBe(400);

    const unsafeTargetFilter = await request(application)
      .get("/api/targets?plant[$ne]=100000000000000000000001")
      .set("Cookie", manager.cookies);
    expect(unsafeTargetFilter.status).toBe(400);

    const invalidActualObjectId = await request(application)
      .post("/api/actuals")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", manager.csrf)
      .set("Cookie", manager.cookies)
      .send(actualPayload({ plant: "bad" }));
    expect(invalidActualObjectId.status).toBe(400);

    const invalidActualMonth = await request(application)
      .post("/api/actuals")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", manager.csrf)
      .set("Cookie", manager.cookies)
      .send(actualPayload({ month: 0 }));
    expect(invalidActualMonth.status).toBe(400);

    const invalidActualValue = await request(application)
      .post("/api/actuals")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", manager.csrf)
      .set("Cookie", manager.cookies)
      .send(actualPayload({ actualValue: -1 }));
    expect(invalidActualValue.status).toBe(400);

    const unexpectedActualField = await request(application)
      .post("/api/actuals")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", manager.csrf)
      .set("Cookie", manager.cookies)
      .send(actualPayload({ role: "ADMIN" }));
    expect(unexpectedActualField.status).toBe(400);

    const invalidActualSort = await request(application)
      .get("/api/actuals?sort=passwordHash")
      .set("Cookie", manager.cookies);
    expect(invalidActualSort.status).toBe(400);

    const invalidActualPagination = await request(application)
      .get("/api/actuals?page=0&limit=500")
      .set("Cookie", manager.cookies);
    expect(invalidActualPagination.status).toBe(400);

    const unsafeActualFilter = await request(application)
      .get("/api/actuals?plant[$ne]=100000000000000000000001")
      .set("Cookie", manager.cookies);
    expect(unsafeActualFilter.status).toBe(400);

    const admin = await login(application, "admin@aop.local");
    const invalidObjectId = await request(application)
      .patch("/api/users/not-an-object-id")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", admin.csrf)
      .set("Cookie", admin.cookies)
      .send({ role: "STAFF" });
    expect(invalidObjectId.status).toBe(400);

    const body = JSON.stringify(invalid.body);
    expect(body).not.toContain("stack");
    expect(body).not.toContain("mongodb");
    expect(body).not.toContain("accessToken");
    expect(body).not.toContain("Password123!");
  });

  it("supports Phase 3 target planning authorization, material rules, and status lifecycle", async () => {
    const application = app();
    const admin = await login(application, "admin@aop.local");
    const manager = await login(application, "manager@aop.local");
    const lead = await login(application, "lead-a@aop.local");
    const staff = await login(application, "staff@aop.local");

    const staffList = await request(application).get("/api/targets").set("Cookie", staff.cookies);
    expect(staffList.status).toBe(403);

    const adminCreate = await request(application)
      .post("/api/targets")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", admin.csrf)
      .set("Cookie", admin.cookies)
      .send(targetPayload({ month: 4, metricType: "TURNOVER", plannedValue: 20 }));
    expect(adminCreate.status).toBe(201);

    const managerEdit = await request(application)
      .patch(`/api/targets/${adminCreate.body.target.id}`)
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", manager.csrf)
      .set("Cookie", manager.cookies)
      .send(targetPayload({ month: 4, metricType: "TURNOVER", plannedValue: 25 }));
    expect(managerEdit.status).toBe(200);
    expect(managerEdit.body.target.plannedValue).toBe(25);

    const leadCreate = await request(application)
      .post("/api/targets")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", lead.csrf)
      .set("Cookie", lead.cookies)
      .send(targetPayload({ month: 5, metricType: "EARNINGS", plannedValue: 30 }));
    expect(leadCreate.status).toBe(201);

    const missingConsumptionMaterial = await request(application)
      .post("/api/targets")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", manager.csrf)
      .set("Cookie", manager.cookies)
      .send(targetPayload({ month: 6, metricType: "CONSUMPTION", material: null }));
    expect(missingConsumptionMaterial.status).toBe(400);

    const materialOnTurnover = await request(application)
      .post("/api/targets")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", manager.csrf)
      .set("Cookie", manager.cookies)
      .send(targetPayload({ month: 6, metricType: "TURNOVER", material: "200000000000000000000001" }));
    expect(materialOnTurnover.status).toBe(400);

    const inactiveMaterial = await request(application)
      .post("/api/targets")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", manager.csrf)
      .set("Cookie", manager.cookies)
      .send(targetPayload({ month: 6, metricType: "CONSUMPTION", material: "200000000000000000000002", unit: "EA" }));
    expect(inactiveMaterial.status).toBe(400);

    const consumption = await request(application)
      .post("/api/targets")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", manager.csrf)
      .set("Cookie", manager.cookies)
      .send(targetPayload({ month: 6, metricType: "CONSUMPTION", material: "200000000000000000000001", unit: "EA" }));
    expect(consumption.status).toBe(201);

    const deactivated = await request(application)
      .patch(`/api/targets/${consumption.body.target.id}/status`)
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", manager.csrf)
      .set("Cookie", manager.cookies)
      .send({ isActive: false });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.target.isActive).toBe(false);

    const historical = await request(application)
      .get(`/api/targets/${consumption.body.target.id}`)
      .set("Cookie", manager.cookies);
    expect(historical.status).toBe(200);
    expect(historical.body.target.plannedValue).toBe(consumption.body.target.plannedValue);

    const reactivated = await request(application)
      .patch(`/api/targets/${consumption.body.target.id}/status`)
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", manager.csrf)
      .set("Cookie", manager.cookies)
      .send({ isActive: true });
    expect(reactivated.status).toBe(200);
    expect(reactivated.body.target.isActive).toBe(true);

    expect(application.locals.store.auditLogs.some((entry) => entry.action === "CREATE_TARGET")).toBe(true);
    expect(application.locals.store.auditLogs.some((entry) => entry.action === "UPDATE_TARGET")).toBe(true);
    expect(application.locals.store.auditLogs.some((entry) => entry.action === "DEACTIVATE_TARGET")).toBe(true);
    expect(application.locals.store.auditLogs.some((entry) => entry.action === "REACTIVATE_TARGET")).toBe(true);
    expect(JSON.stringify(application.locals.store.auditLogs)).not.toContain("Password123!");
  });

  it("supports Phase 4 manual actual entry authorization, material rules, source rules, and status lifecycle", async () => {
    const application = app();
    const admin = await login(application, "admin@aop.local");
    const manager = await login(application, "manager@aop.local");
    const lead = await login(application, "lead-a@aop.local");
    const staff = await login(application, "staff@aop.local");

    const staffList = await request(application).get("/api/actuals").set("Cookie", staff.cookies);
    expect(staffList.status).toBe(403);

    const adminCreate = await request(application)
      .post("/api/actuals")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", admin.csrf)
      .set("Cookie", admin.cookies)
      .send(actualPayload({ month: 4, metricType: "TURNOVER", actualValue: 20 }));
    expect(adminCreate.status).toBe(201);
    expect(adminCreate.body.actual.source).toBe("MANUAL");

    const managerEdit = await request(application)
      .patch(`/api/actuals/${adminCreate.body.actual.id}`)
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", manager.csrf)
      .set("Cookie", manager.cookies)
      .send(actualPayload({ month: 4, metricType: "TURNOVER", actualValue: 25 }));
    expect(managerEdit.status).toBe(200);
    expect(managerEdit.body.actual.actualValue).toBe(25);

    const leadCreate = await request(application)
      .post("/api/actuals")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", lead.csrf)
      .set("Cookie", lead.cookies)
      .send(actualPayload({ month: 5, metricType: "EARNINGS", actualValue: 30 }));
    expect(leadCreate.status).toBe(201);

    const forbiddenLeadPlant = await request(application)
      .post("/api/actuals")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", lead.csrf)
      .set("Cookie", lead.cookies)
      .send(actualPayload({ plant: "100000000000000000000002", month: 5, metricType: "EARNINGS" }));
    expect(forbiddenLeadPlant.status).toBe(403);

    const excelImport = await request(application)
      .post("/api/actuals")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", manager.csrf)
      .set("Cookie", manager.cookies)
      .send(actualPayload({ month: 6, source: "EXCEL_IMPORT" }));
    expect(excelImport.status).toBe(400);

    const missingConsumptionMaterial = await request(application)
      .post("/api/actuals")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", manager.csrf)
      .set("Cookie", manager.cookies)
      .send(actualPayload({ month: 6, metricType: "CONSUMPTION", material: null }));
    expect(missingConsumptionMaterial.status).toBe(400);

    const materialOnTurnover = await request(application)
      .post("/api/actuals")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", manager.csrf)
      .set("Cookie", manager.cookies)
      .send(actualPayload({ month: 6, metricType: "TURNOVER", material: "200000000000000000000001" }));
    expect(materialOnTurnover.status).toBe(400);

    const inactiveMaterial = await request(application)
      .post("/api/actuals")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", manager.csrf)
      .set("Cookie", manager.cookies)
      .send(actualPayload({ month: 6, metricType: "CONSUMPTION", material: "200000000000000000000002", unit: "EA" }));
    expect(inactiveMaterial.status).toBe(400);

    const consumption = await request(application)
      .post("/api/actuals")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", manager.csrf)
      .set("Cookie", manager.cookies)
      .send(actualPayload({ month: 6, metricType: "CONSUMPTION", material: "200000000000000000000001", unit: "EA" }));
    expect(consumption.status).toBe(201);

    const deactivated = await request(application)
      .patch(`/api/actuals/${consumption.body.actual.id}/status`)
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", manager.csrf)
      .set("Cookie", manager.cookies)
      .send({ isActive: false });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.actual.isActive).toBe(false);

    const historical = await request(application)
      .get(`/api/actuals/${consumption.body.actual.id}`)
      .set("Cookie", manager.cookies);
    expect(historical.status).toBe(200);
    expect(historical.body.actual.actualValue).toBe(consumption.body.actual.actualValue);

    const reactivated = await request(application)
      .patch(`/api/actuals/${consumption.body.actual.id}/status`)
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", manager.csrf)
      .set("Cookie", manager.cookies)
      .send({ isActive: true });
    expect(reactivated.status).toBe(200);
    expect(reactivated.body.actual.isActive).toBe(true);

    expect(application.locals.store.auditLogs.some((entry) => entry.action === "CREATE_ACTUAL")).toBe(true);
    expect(application.locals.store.auditLogs.some((entry) => entry.action === "UPDATE_ACTUAL")).toBe(true);
    expect(application.locals.store.auditLogs.some((entry) => entry.action === "DEACTIVATE_ACTUAL")).toBe(true);
    expect(application.locals.store.auditLogs.some((entry) => entry.action === "REACTIVATE_ACTUAL")).toBe(true);
    expect(JSON.stringify(application.locals.store.auditLogs)).not.toContain("Password123!");
  });

  it("supports Phase 5 import preview, history authorization, and transaction fail-closed confirmation", async () => {
    const application = app();
    const manager = await login(application, "manager@aop.local");
    const staff = await login(application, "staff@aop.local");
    const fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), "aop-phase5-"));
    const validCsv = path.join(fixtureDir, "valid.csv");
    const badHeadersCsv = path.join(fixtureDir, "bad-headers.csv");
    await fs.writeFile(validCsv, "plantCode,financialYearLabel,month,metricType,category,materialCode,actualValue,unit,notes\nPLANT-A,2026,8,TURNOVER,TOTAL,,42,USD,\n");
    await fs.writeFile(badHeadersCsv, "plantId,source,createdBy\nPLANT-A,EXCEL_IMPORT,attacker\n");

    const staffPreview = await request(application)
      .post("/api/imports/preview")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", staff.csrf)
      .set("Cookie", staff.cookies);
    expect(staffPreview.status).toBe(403);

    const badHeaders = await request(application)
      .post("/api/imports/preview")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", manager.csrf)
      .set("Cookie", manager.cookies)
      .attach("file", badHeadersCsv);
    expect(badHeaders.status).toBe(400);

    const beforeActuals = application.locals.store.actuals.length;
    const preview = await request(application)
      .post("/api/imports/preview")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", manager.csrf)
      .set("Cookie", manager.cookies)
      .attach("file", validCsv);
    expect(preview.status).toBe(201);
    expect(preview.body.batch.validRows).toBe(1);
    expect(preview.body.batch.invalidRows).toBe(0);
    expect(application.locals.store.actuals).toHaveLength(beforeActuals);

    const history = await request(application)
      .get("/api/imports/history")
      .set("Cookie", manager.cookies);
    expect(history.status).toBe(200);
    expect(history.body.rows.some((batch) => batch.id === preview.body.batch.id)).toBe(true);

    const staffHistory = await request(application)
      .get("/api/imports/history")
      .set("Cookie", staff.cookies);
    expect(staffHistory.status).toBe(403);

    const confirm = await request(application)
      .post(`/api/imports/${preview.body.batch.id}/confirm`)
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", manager.csrf)
      .set("Cookie", manager.cookies);
    expect(confirm.status).toBe(409);
    expect(confirm.body.error.code).toBe("TRANSACTIONAL_IMPORT_REQUIRED");
    expect(application.locals.store.actuals).toHaveLength(beforeActuals);
    expect(application.locals.store.auditLogs.some((entry) => entry.action === "IMPORT_PREVIEW")).toBe(true);
    expect(application.locals.store.auditLogs.some((entry) => entry.action === "IMPORT_REJECTED")).toBe(true);
    expect(JSON.stringify(preview.body)).not.toContain("EXCEL_IMPORT,attacker");
    await fs.rm(fixtureDir, { recursive: true, force: true });
  });

  it("calculates Phase 6 reports with status rules and backend plant scope", async () => {
    const application = app();
    const manager = await login(application, "manager@aop.local");
    const staff = await login(application, "staff@aop.local");
    const plantA = application.locals.store.plants[0];
    const year = application.locals.store.financialYears[0];
    const material = application.locals.store.materials[0];
    const adminId = application.locals.store.users[0].id;
    const base = {
      plant: plantA,
      financialYear: year,
      metricType: "TURNOVER",
      category: "TOTAL",
      material: null,
      notes: "",
      isActive: true,
      createdBy: adminId,
      updatedBy: adminId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    application.locals.store.targets.push(
      { ...base, id: "400000000000000000000101", month: 2, plannedValue: 0, unit: "USD" },
      { ...base, id: "400000000000000000000102", month: 3, plannedValue: 50, unit: "USD" },
      { ...base, id: "400000000000000000000103", month: 4, plannedValue: 75, unit: "USD" },
      { ...base, id: "400000000000000000000104", month: 6, category: "TURNON", plannedValue: 100, unit: "USD" },
      { ...base, id: "400000000000000000000105", month: 7, category: "TURNWARN", plannedValue: 100, unit: "USD" },
      { ...base, id: "400000000000000000000106", month: 8, category: "TURNCRIT", plannedValue: 100, unit: "USD" },
      { ...base, id: "400000000000000000000107", month: 6, metricType: "EXPENSE", category: "EXPON", plannedValue: 100, unit: "USD" },
      { ...base, id: "400000000000000000000108", month: 7, metricType: "EXPENSE", category: "EXPWARN", plannedValue: 100, unit: "USD" },
      { ...base, id: "400000000000000000000109", month: 8, metricType: "EXPENSE", category: "EXPCRIT", plannedValue: 100, unit: "USD" },
      { ...base, id: "400000000000000000000110", month: 6, metricType: "EARNINGS", category: "EARNON", plannedValue: 100, unit: "USD" },
      { ...base, id: "400000000000000000000111", month: 6, metricType: "CONSUMPTION", category: "CONSON", material, plannedValue: 100, unit: "EA" }
    );
    application.locals.store.actuals.push(
      { ...base, id: "500000000000000000000101", month: 2, actualValue: 10, unit: "USD", source: "MANUAL" },
      { ...base, id: "500000000000000000000102", month: 3, actualValue: 40, unit: "EUR", source: "MANUAL" },
      { ...base, id: "500000000000000000000103", month: 5, actualValue: 60, unit: "USD", source: "MANUAL" },
      { ...base, id: "500000000000000000000104", month: 6, category: "TURNON", actualValue: 105, unit: "USD", source: "MANUAL" },
      { ...base, id: "500000000000000000000105", month: 7, category: "TURNWARN", actualValue: 95, unit: "USD", source: "MANUAL" },
      { ...base, id: "500000000000000000000106", month: 8, category: "TURNCRIT", actualValue: 80, unit: "USD", source: "MANUAL" },
      { ...base, id: "500000000000000000000107", month: 6, metricType: "EXPENSE", category: "EXPON", actualValue: 90, unit: "USD", source: "MANUAL" },
      { ...base, id: "500000000000000000000108", month: 7, metricType: "EXPENSE", category: "EXPWARN", actualValue: 105, unit: "USD", source: "MANUAL" },
      { ...base, id: "500000000000000000000109", month: 8, metricType: "EXPENSE", category: "EXPCRIT", actualValue: 111, unit: "USD", source: "MANUAL" },
      { ...base, id: "500000000000000000000110", month: 6, metricType: "EARNINGS", category: "EARNON", actualValue: 100, unit: "USD", source: "MANUAL" },
      { ...base, id: "500000000000000000000111", month: 6, metricType: "CONSUMPTION", category: "CONSON", material, actualValue: 90, unit: "EA", source: "MANUAL" }
    );

    const targetData = await request(application)
      .get("/api/reports/target-data?financialYear=300000000000000000000001&limit=100")
      .set("Cookie", manager.cookies);
    expect(targetData.status).toBe(200);
    const dataStatuses = targetData.body.rows.map((row) => row.dataStatus);
    expect(dataStatuses).toContain("MATCHED");
    expect(dataStatuses).toContain("ZERO_TARGET");
    expect(dataStatuses).toContain("UNIT_MISMATCH");
    expect(dataStatuses).toContain("MISSING_ACTUAL");
    expect(dataStatuses).toContain("MISSING_TARGET");
    const performanceStatuses = targetData.body.rows.map((row) => row.performanceStatus);
    expect(performanceStatuses).toContain("ON_TRACK");
    expect(performanceStatuses).toContain("WARNING");
    expect(performanceStatuses).toContain("CRITICAL");
    const zeroTarget = targetData.body.rows.find((row) => row.dataStatus === "ZERO_TARGET");
    expect(zeroTarget.attainmentPct).toBeNull();
    expect(zeroTarget.variance).toBe(10);
    expect(zeroTarget.performanceStatus).toBeNull();
    const unitMismatch = targetData.body.rows.find((row) => row.dataStatus === "UNIT_MISMATCH");
    expect(unitMismatch.variance).toBeNull();
    expect(unitMismatch.attainmentPct).toBeNull();
    expect(unitMismatch.performanceStatus).toBeNull();
    expect(targetData.body.rows.find((row) => row.category === "TURNON")).toMatchObject({ dataStatus: "MATCHED", performanceStatus: "ON_TRACK", attainmentPct: 105 });
    expect(targetData.body.rows.find((row) => row.category === "TURNWARN")).toMatchObject({ dataStatus: "MATCHED", performanceStatus: "WARNING", attainmentPct: 95 });
    expect(targetData.body.rows.find((row) => row.category === "TURNCRIT")).toMatchObject({ dataStatus: "MATCHED", performanceStatus: "CRITICAL", attainmentPct: 80 });
    expect(targetData.body.rows.find((row) => row.category === "EXPON")).toMatchObject({ dataStatus: "MATCHED", performanceStatus: "ON_TRACK" });
    expect(targetData.body.rows.find((row) => row.category === "EXPWARN")).toMatchObject({ dataStatus: "MATCHED", performanceStatus: "WARNING" });
    expect(targetData.body.rows.find((row) => row.category === "EXPCRIT")).toMatchObject({ dataStatus: "MATCHED", performanceStatus: "CRITICAL" });
    expect(targetData.body.rows.find((row) => row.category === "EARNON")).toMatchObject({ dataStatus: "MATCHED", performanceStatus: "ON_TRACK" });
    expect(targetData.body.rows.find((row) => row.category === "CONSON")).toMatchObject({ dataStatus: "MATCHED", performanceStatus: "ON_TRACK" });

    const summary = await request(application)
      .get("/api/reports/summary?financialYear=300000000000000000000001")
      .set("Cookie", manager.cookies);
    expect(summary.status).toBe(200);
    expect(summary.body.dataStatusCounts.UNIT_MISMATCH).toBeGreaterThan(0);
    expect(summary.body.performanceStatusCounts.CRITICAL).toBeGreaterThan(0);

    const plantPerformance = await request(application)
      .get("/api/reports/plant-performance?financialYear=300000000000000000000001")
      .set("Cookie", staff.cookies);
    expect(plantPerformance.status).toBe(200);
    expect(plantPerformance.body.rows.every((row) => row.plant.code === "PLANT-A")).toBe(true);

    const staffTargetData = await request(application)
      .get("/api/reports/target-data?financialYear=300000000000000000000001&limit=100")
      .set("Cookie", staff.cookies);
    expect(staffTargetData.status).toBe(200);
    expect(staffTargetData.body.rows.every((row) => row.plant.code === "PLANT-A")).toBe(true);

    const forbiddenWrite = await request(application)
      .post("/api/reports/summary")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", staff.csrf)
      .set("Cookie", staff.cookies)
      .send({});
    expect(forbiddenWrite.status).toBe(404);

    const zeroTargetWrite = await request(application)
      .post("/api/targets")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", manager.csrf)
      .set("Cookie", manager.cookies)
      .send(targetPayload({ month: 9, metricType: "EXPENSE", category: "ZEROACT", plannedValue: 10, unit: "USD" }));
    expect(zeroTargetWrite.status).toBe(201);
    const zeroActualWrite = await request(application)
      .post("/api/actuals")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", manager.csrf)
      .set("Cookie", manager.cookies)
      .send(actualPayload({ month: 9, metricType: "EXPENSE", category: "ZEROACT", actualValue: 0, unit: "USD" }));
    expect(zeroActualWrite.status).toBe(201);
    const zeroActualReport = await request(application)
      .get("/api/reports/target-data?financialYear=300000000000000000000001&month=9&metricType=EXPENSE")
      .set("Cookie", manager.cookies);
    expect(zeroActualReport.body.rows.find((row) => row.category === "ZEROACT")).toMatchObject({ actualValue: 0, dataStatus: "MATCHED", performanceStatus: "ON_TRACK" });

    const mismatchedActual = await request(application)
      .post("/api/actuals")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", manager.csrf)
      .set("Cookie", manager.cookies)
      .send(actualPayload({ month: 9, metricType: "EXPENSE", category: "ZEROACT", unit: "EUR" }));
    expect(mismatchedActual.status).toBe(400);
    expect(mismatchedActual.body.error.code).toBe("UNIT_MISMATCH");
  });

  it("exposes read-only sanitized audit logs to admins with safe filters", async () => {
    const application = app();
    const admin = await login(application, "admin@aop.local");
    const staff = await login(application, "staff@aop.local");

    await request(application).get("/api/users").set("Cookie", staff.cookies);
    await application.locals.store.auditLogs.push({
      action: "CREATE_TARGET",
      entityType: "Target",
      entityId: "sensitive",
      before: { password: "Password123!", cookie: "csrfToken=secret", url: "mongodb://localhost:27017/secret" },
      after: { accessToken: "token-value" },
      requestId: "manual",
      createdAt: new Date().toISOString()
    });

    const logs = await request(application)
      .get("/api/audit-logs?action=CREATE_TARGET&sort=-createdAt&page=1&limit=10")
      .set("Cookie", admin.cookies);
    expect(logs.status).toBe(200);
    expect(logs.body.rows.some((entry) => entry.action === "CREATE_TARGET")).toBe(true);
    const body = JSON.stringify(logs.body);
    expect(body).not.toContain("Password123!");
    expect(body).not.toContain("csrfToken=secret");
    expect(body).not.toContain("mongodb://");
    expect(body).not.toContain("token-value");

    const unsafe = await request(application)
      .get("/api/audit-logs?action[$ne]=LOGIN_SUCCESS")
      .set("Cookie", admin.cookies);
    expect(unsafe.status).toBe(400);

    const update = await request(application)
      .patch("/api/audit-logs/sensitive")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", admin.csrf)
      .set("Cookie", admin.cookies)
      .send({ action: "CHANGED" });
    expect(update.status).toBe(404);

    const remove = await request(application)
      .delete("/api/audit-logs/sensitive")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", admin.csrf)
      .set("Cookie", admin.cookies);
    expect(remove.status).toBe(404);
  });

  it("supports admin master-data management and read-only access for other roles", async () => {
    const application = app();
    const admin = await login(application, "admin@aop.local");
    const manager = await login(application, "manager@aop.local");
    const staff = await login(application, "staff@aop.local");
    const lead = await login(application, "lead-a@aop.local");

    const created = await request(application)
      .post("/api/master-data/plants")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", admin.csrf)
      .set("Cookie", admin.cookies)
      .send({ name: "Plant C", code: "plant-c", location: "East Campus", businessUnit: "Operations", isActive: true });
    expect(created.status).toBe(201);
    expect(created.body.plant.code).toBe("PLANT-C");

    const edited = await request(application)
      .patch(`/api/master-data/plants/${created.body.plant.id}`)
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", admin.csrf)
      .set("Cookie", admin.cookies)
      .send({ location: "West Campus", isActive: false });
    expect(edited.status).toBe(200);
    expect(edited.body.plant.location).toBe("West Campus");
    expect(edited.body.plant.isActive).toBe(false);

    const managerWrite = await request(application)
      .post("/api/master-data/materials")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", manager.csrf)
      .set("Cookie", manager.cookies)
      .send({ name: "Blocked", code: "MAT-X", category: "Raw", unit: "KG", isActive: true });
    expect(managerWrite.status).toBe(403);

    for (const auth of [staff, lead]) {
      const denied = await request(application)
        .post("/api/master-data/plants")
        .set("Origin", "http://localhost:5173")
        .set("X-CSRF-Token", auth.csrf)
        .set("Cookie", auth.cookies)
        .send({ name: "Blocked", code: "PLANT-X", location: "Blocked", businessUnit: "Blocked", isActive: true });
      expect(denied.status).toBe(403);
    }

    const staffRead = await request(application).get("/api/master-data/plants").set("Cookie", staff.cookies);
    expect(staffRead.status).toBe(200);
    expect(staffRead.body.rows.every((plant) => plant.isActive)).toBe(true);

    expect(application.locals.store.auditLogs.some((entry) => entry.action === "CREATE_MASTER_DATA" && entry.entityType === "Plant")).toBe(true);
    expect(application.locals.store.auditLogs.some((entry) => entry.action === "DEACTIVATE_MASTER_DATA" && entry.entityType === "Plant")).toBe(true);
  });

  it("enforces master-data duplicate, validation, active, and reference constraints", async () => {
    const application = app();
    const admin = await login(application, "admin@aop.local");
    const manager = await login(application, "manager@aop.local");

    const duplicatePlant = await request(application)
      .post("/api/master-data/plants")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", admin.csrf)
      .set("Cookie", admin.cookies)
      .send({ name: "Duplicate", code: "PLANT-A", location: "North", businessUnit: "Operations", isActive: true });
    expect(duplicatePlant.status).toBe(409);

    const duplicateMaterial = await request(application)
      .post("/api/master-data/materials")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", admin.csrf)
      .set("Cookie", admin.cookies)
      .send({ name: "Duplicate", code: "MAT-A", category: "Finished Goods", unit: "EA", isActive: true });
    expect(duplicateMaterial.status).toBe(409);

    const duplicateYear = await request(application)
      .post("/api/master-data/financial-years")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", admin.csrf)
      .set("Cookie", admin.cookies)
      .send({ label: "2026", startDate: "2026-01-01", endDate: "2026-12-31", isActive: false });
    expect(duplicateYear.status).toBe(409);

    const invalidDate = await request(application)
      .post("/api/master-data/financial-years")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", admin.csrf)
      .set("Cookie", admin.cookies)
      .send({ label: "2027", startDate: "2027-12-31", endDate: "2027-01-01", isActive: false });
    expect(invalidDate.status).toBe(400);

    const unknownField = await request(application)
      .post("/api/master-data/materials")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", admin.csrf)
      .set("Cookie", admin.cookies)
      .send({ name: "Material B", code: "MAT-B", category: "Raw", unit: "KG", isActive: true, role: "ADMIN" });
    expect(unknownField.status).toBe(400);

    const invalidSort = await request(application)
      .get("/api/master-data/plants?sort=passwordHash")
      .set("Cookie", manager.cookies);
    expect(invalidSort.status).toBe(400);

    const invalidPagination = await request(application)
      .get("/api/master-data/plants?page=0&limit=500")
      .set("Cookie", manager.cookies);
    expect(invalidPagination.status).toBe(400);

    const unsafeFilter = await request(application)
      .get("/api/master-data/plants?search[$ne]=x")
      .set("Cookie", manager.cookies);
    expect(unsafeFilter.status).toBe(400);

    const invalidObjectId = await request(application)
      .patch("/api/master-data/plants/not-an-object-id")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", admin.csrf)
      .set("Cookie", admin.cookies)
      .send({ location: "Nowhere" });
    expect(invalidObjectId.status).toBe(400);

    const inactivePlantWrite = await request(application)
      .post("/api/targets")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", manager.csrf)
      .set("Cookie", manager.cookies)
      .send(targetPayload({ plant: "100000000000000000000003" }));
    expect(inactivePlantWrite.status).toBe(400);

    const inactiveYearWrite = await request(application)
      .post("/api/actuals")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", manager.csrf)
      .set("Cookie", manager.cookies)
      .send(actualPayload({ financialYear: "300000000000000000000002" }));
    expect(inactiveYearWrite.status).toBe(400);

    const deleteReferencedPlant = await request(application)
      .delete("/api/master-data/plants/100000000000000000000001")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", admin.csrf)
      .set("Cookie", admin.cookies);
    expect(deleteReferencedPlant.status).toBe(409);
  });
});
