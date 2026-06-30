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
  });

  it("enforces server-side plant scope and rejects frontend-supplied unsafe operators", async () => {
    const application = app();
    const lead = await login(application, "lead-a@aop.local");

    const report = await request(application).get("/api/reports/summary").set("Cookie", lead.cookies);
    expect(report.status).toBe(200);
    expect(report.body.rows.every((row) => row.plantId === "PLANT-A")).toBe(true);
    expect(report.body.actuals.every((row) => row.plantId === "PLANT-A")).toBe(true);

    const plantBReport = await request(application)
      .get("/api/reports/summary?plantId=PLANT-B")
      .set("Cookie", lead.cookies);
    expect(plantBReport.status).toBe(200);
    expect(plantBReport.body.rows).toHaveLength(0);
    expect(plantBReport.body.actuals).toHaveLength(0);

    const forbiddenPlant = await request(application)
      .post("/api/targets")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", lead.csrf)
      .set("Cookie", lead.cookies)
      .send({ plantId: "PLANT-B", financialYear: "2027", metricType: "output", value: 50 });
    expect(forbiddenPlant.status).toBe(403);

    const otherPlantTarget = application.locals.store.targets.find((target) => target.plantId === "PLANT-B");
    const guessedRead = await request(application)
      .get(`/api/targets/${otherPlantTarget.id}`)
      .set("Cookie", lead.cookies);
    expect(guessedRead.status).toBe(403);

    const guessedEdit = await request(application)
      .patch(`/api/targets/${otherPlantTarget.id}`)
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", lead.csrf)
      .set("Cookie", lead.cookies)
      .send({ plantId: "PLANT-B", financialYear: "2026", metricType: "output", value: 999 });
    expect(guessedEdit.status).toBe(403);
    expect(application.locals.store.targets.find((target) => target.id === otherPlantTarget.id).value).toBe(200);

    const guessedDelete = await request(application)
      .delete(`/api/targets/${otherPlantTarget.id}`)
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", lead.csrf)
      .set("Cookie", lead.cookies);
    expect(guessedDelete.status).toBe(403);
    expect(application.locals.store.targets.some((target) => target.id === otherPlantTarget.id)).toBe(true);

    const otherPlantActual = application.locals.store.actuals.find((actual) => actual.plantId === "PLANT-B");
    const guessedActualRead = await request(application)
      .get(`/api/actuals/${otherPlantActual.id}`)
      .set("Cookie", lead.cookies);
    expect(guessedActualRead.status).toBe(403);

    const guessedActualDelete = await request(application)
      .delete(`/api/actuals/${otherPlantActual.id}`)
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", lead.csrf)
      .set("Cookie", lead.cookies);
    expect(guessedActualDelete.status).toBe(403);

    const unsafe = await request(application)
      .post("/api/targets")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", lead.csrf)
      .set("Cookie", lead.cookies)
      .send({ plantId: { $ne: "PLANT-A" }, financialYear: "2027", metricType: "output", value: 50 });
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
      .send({ plantId: "PLANT-A", financialYear: "2027", metricType: "output", period: "2027-01", value: 50 });
    expect(actualWithoutCsrf.status).toBe(403);

    const userPatchWithoutCsrf = await request(application)
      .patch("/api/users/000000000000000000000004")
      .set("Origin", "http://localhost:5173")
      .set("Cookie", manager.cookies)
      .send({ role: "STAFF" });
    expect(userPatchWithoutCsrf.status).toBe(403);

    const report = await request(application).get("/api/reports/summary").set("Cookie", manager.cookies);
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
    await fs.writeFile(csvPath, "plantId,metricType,value\nPLANT-A,output,10\nPLANT-B,output,20\n");
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

    const tooManyRowsApp = app({ IMPORT_MAX_ROWS: "1" });
    const tooManyRowsAuth = await login(tooManyRowsApp, "manager@aop.local");
    const tooManyRows = await request(tooManyRowsApp)
      .post("/api/imports/preview")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", tooManyRowsAuth.csrf)
      .set("Cookie", tooManyRowsAuth.cookies)
      .attach("file", csvPath);
    expect(tooManyRows.status).toBe(400);

    const lead = await login(application, "lead-a@aop.local");
    const preview = await request(application)
      .post("/api/imports/preview")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", lead.csrf)
      .set("Cookie", lead.cookies)
      .attach("file", csvPath);
    expect(preview.status).toBe(201);
    expect(preview.body.preview[1].errors).toContain("plant is outside assigned scope");

    const batch = application.locals.store.importBatches.find((candidate) => candidate.id === preview.body.batchId);
    expect(batch.tempPath).toBeNull();
    const confirm = await request(application)
      .post(`/api/imports/${preview.body.batchId}/confirm`)
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", lead.csrf)
      .set("Cookie", lead.cookies);
    expect(confirm.status).toBe(403);
    await fs.rm(fixtureDir, { recursive: true, force: true });
  });

  it("escapes formula-like values in exports and audits authorization failures", async () => {
    const application = app();
    application.locals.store.targets.push({ id: "formula", plantId: "PLANT-A", financialYear: "2026", metricType: "output", value: "=SUM(1,1)" });
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
    const payload = { plantId: "PLANT-A", financialYear: "2031", metricType: "output", value: 10 };
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

    const actualPayload = { plantId: "PLANT-A", financialYear: "2031", metricType: "output", period: "2031-01", value: 10 };
    const [actualFirst, actualSecond] = await Promise.all([
      request(application)
        .post("/api/actuals")
        .set("Origin", "http://localhost:5173")
        .set("X-CSRF-Token", manager.csrf)
        .set("Cookie", manager.cookies)
        .send(actualPayload),
      request(application)
        .post("/api/actuals")
        .set("Origin", "http://localhost:5173")
        .set("X-CSRF-Token", manager.csrf)
        .set("Cookie", manager.cookies)
        .send(actualPayload)
    ]);
    expect([actualFirst.status, actualSecond.status].sort()).toEqual([201, 409]);

    const invalid = await request(application)
      .post("/api/targets")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", manager.csrf)
      .set("Cookie", manager.cookies)
      .send({ plantId: "PLANT-A", financialYear: "bad", metricType: "output", value: 10 });
    expect(invalid.status).toBe(400);

    const unexpectedField = await request(application)
      .post("/api/targets")
      .set("Origin", "http://localhost:5173")
      .set("X-CSRF-Token", manager.csrf)
      .set("Cookie", manager.cookies)
      .send({ plantId: "PLANT-A", financialYear: "2032", metricType: "output", value: 10, role: "ADMIN" });
    expect(unexpectedField.status).toBe(400);

    const invalidSort = await request(application)
      .get("/api/reports/summary?sort=passwordHash")
      .set("Cookie", manager.cookies);
    expect(invalidSort.status).toBe(400);

    const invalidPagination = await request(application)
      .get("/api/reports/summary?page=0&limit=1000")
      .set("Cookie", manager.cookies);
    expect(invalidPagination.status).toBe(400);

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
});
