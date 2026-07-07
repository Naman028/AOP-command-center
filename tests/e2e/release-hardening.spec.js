import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

const apiBase = "http://127.0.0.1:4100/api";
const origin = "http://127.0.0.1:5174";
const temporaryFiles = new Set();

test.beforeEach(async ({ page }) => {
  await page.context().clearCookies();
});

test.afterEach(async () => {
  await Promise.all(Array.from(temporaryFiles, async (filePath) => {
    await fs.rm(filePath, { force: true });
    temporaryFiles.delete(filePath);
  }));
});

test("admin user lifecycle and forced password change", async ({ page }) => {
  const prefix = e2ePrefix();
  await login(page, "admin@aop.local", "Password123!");
  await page.goto("/admin/users");
  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();

  await page.getByRole("button", { name: "Create" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill(`${prefix} Lead`);
  await dialog.getByLabel("Email").fill(`${prefix.toLowerCase()}-lead@aop.local`);
  await dialog.getByLabel("Temporary password").fill("Temporary123!");
  await dialog.locator("select").first().selectOption("TEAM_LEAD");
  await dialog.locator("select").nth(1).selectOption({ label: "PLANT-A - Plant A" });
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(`${prefix.toLowerCase()}-lead@aop.local`)).toBeVisible();
  await expect(page.getByText("Temporary123!")).toHaveCount(0);

  await logout(page);
  await login(page, `${prefix.toLowerCase()}-lead@aop.local`, "Temporary123!");
  await expect(page).toHaveURL(/\/change-password$/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/change-password$/);

  await changePassword(page, "Temporary123!", "ChangedPassword123!");

  await login(page, `${prefix.toLowerCase()}-lead@aop.local`, "ChangedPassword123!");
  await page.goto("/reports/target-data");
  await expect(page.getByRole("heading", { name: "Target Data Report" })).toBeVisible();
  await expect(page.getByText("PLANT-A").first()).toBeVisible();
  await expect(page.getByText("PLANT-B")).toHaveCount(0);
});

test("operational target actual report and export flow", async ({ page }) => {
  const prefix = e2ePrefix();
  await login(page, "admin@aop.local", "Password123!");
  const csrf = await csrfToken(page);
  const refs = await loadRefs(page);
  const category = `${prefix}-OPS`;

  await api(page, "POST", "/targets", csrf, {
    plant: refs.plantA.id,
    financialYear: refs.year.id,
    month: 12,
    metricType: "TURNOVER",
    category,
    plannedValue: 123,
    unit: "USD",
    notes: "E2E target"
  });
  await api(page, "POST", "/actuals", csrf, {
    plant: refs.plantA.id,
    financialYear: refs.year.id,
    month: 12,
    metricType: "TURNOVER",
    category,
    actualValue: 111,
    unit: "USD",
    source: "MANUAL",
    notes: "E2E actual"
  });

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("TURNOVER").first()).toBeVisible();

  await page.goto("/reports/target-data");
  await page.getByLabel("Metric").selectOption("TURNOVER");
  await page.getByLabel("Month").selectOption("12");
  await expect(page.getByText(category)).toBeVisible();
  await expect(page.getByRole("cell", { name: "123" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "111" })).toBeVisible();

  const exportResponse = await page.request.post(`${apiBase}/reports/target-data/export`, {
    headers: {
      Origin: origin,
      "X-CSRF-Token": await csrfToken(page),
      "Content-Type": "application/json"
    },
    data: {
      financialYear: refs.year.id,
      plant: refs.plantA.id,
      metricType: "TURNOVER"
    }
  });
  expect(exportResponse.status()).toBe(200);
  expect(exportResponse.headers()["content-type"]).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  expect((await exportResponse.body())[0]).toBe(0x50);
});

test("authorization regression across roles and direct API manipulation", async ({ page }) => {
  await login(page, "lead-a@aop.local", "Password123!");
  const refs = await loadRefs(page);

  await page.goto("/reports/target-data");
  await expect(page.getByText("PLANT-B")).toHaveCount(0);
  const plantBReport = await page.request.get(`${apiBase}/reports/target-data?financialYear=${refs.year.id}&plant=${refs.plantB.id}`);
  expect(plantBReport.status()).toBe(200);
  expect((await plantBReport.json()).rows).toHaveLength(0);

  const csrf = await csrfToken(page);
  const plantBExport = await page.request.post(`${apiBase}/reports/target-data/export`, {
    headers: { Origin: origin, "X-CSRF-Token": csrf, "Content-Type": "application/json" },
    data: { financialYear: refs.year.id, plant: refs.plantB.id }
  });
  expect(plantBExport.status()).toBe(200);
  expect((await plantBExport.body())[0]).toBe(0x50);

  const importPath = await writeImportFile(`PLANT-B,${refs.year.label},12,TURNOVER,E2E-B,,10,USD,blocked`);
  const preview = await page.request.post(`${apiBase}/imports/preview`, {
    headers: { Origin: origin, "X-CSRF-Token": csrf },
    multipart: { file: { name: "blocked.csv", mimeType: "text/csv", buffer: await fs.readFile(importPath) } }
  });
  expect(preview.status()).toBe(201);
  expect((await preview.json()).batch.invalidRows).toBe(1);

  await logout(page);
  await login(page, "staff@aop.local", "Password123!");
  for (const url of ["/planning/turnover", "/actuals/manual-entry", "/actuals/file-drop", "/admin/users"]) {
    await page.goto(url);
    await expect(page).toHaveURL(/\/unauthorized$/);
  }
  const staffExport = await page.request.post(`${apiBase}/reports/target-data/export`, {
    headers: { Origin: origin, "X-CSRF-Token": await csrfToken(page), "Content-Type": "application/json" },
    data: { financialYear: refs.year.id }
  });
  expect(staffExport.status()).toBe(403);

  await logout(page);
  await login(page, "manager@aop.local", "Password123!");
  for (const url of ["/admin/users", "/admin/audit-logs"]) {
    await page.goto(url);
    await expect(page).toHaveURL(/\/unauthorized$/);
  }
});

test("session revocation after plant-scope change", async ({ page, browser }) => {
  const prefix = e2ePrefix();
  await login(page, "admin@aop.local", "Password123!");
  const adminCsrf = await csrfToken(page);
  const refs = await loadRefs(page);
  const created = await api(page, "POST", "/users", adminCsrf, {
    email: `${prefix.toLowerCase()}-scope@aop.local`,
    name: `${prefix} Scope`,
    role: "TEAM_LEAD",
    temporaryPassword: "Temporary123!",
    assignedPlants: [refs.plantA.id]
  });

  const userContext = await browser.newContext();
  const userPage = await userContext.newPage();
  await login(userPage, created.user.email, "Temporary123!");
  await changePassword(userPage, "Temporary123!", "ChangedPassword123!");
  await login(userPage, created.user.email, "ChangedPassword123!");
  await userPage.goto("/reports/target-data");
  await expect(userPage.getByText("PLANT-A").first()).toBeVisible();

  await api(page, "PATCH", `/users/${created.user.id}/plant-scope`, adminCsrf, { assignedPlants: [] });
  const revoked = await userPage.request.get(`${apiBase}/auth/me`);
  expect(revoked.status()).toBe(401);
  await userPage.goto("/dashboard");
  await expect(userPage).toHaveURL(/\/login/);
  await userContext.close();
});

test("import confirmation fails closed without transactions in E2E memory mode", async ({ page }) => {
  await login(page, "manager@aop.local", "Password123!");
  const csrf = await csrfToken(page);
  const refs = await loadRefs(page);
  const importPath = await writeImportFile(`PLANT-A,${refs.year.label},12,TURNOVER,E2E-IMPORT,,10,USD,valid`);

  const preview = await page.request.post(`${apiBase}/imports/preview`, {
    headers: { Origin: origin, "X-CSRF-Token": csrf },
    multipart: { file: { name: "valid.csv", mimeType: "text/csv", buffer: await fs.readFile(importPath) } }
  });
  expect(preview.status()).toBe(201);
  const body = await preview.json();
  expect(body.batch.validRows).toBe(1);
  expect(body.transactionAvailable).toBe(false);

  const confirm = await page.request.post(`${apiBase}/imports/${body.batch.id}/confirm`, {
    headers: { Origin: origin, "X-CSRF-Token": csrf }
  });
  expect(confirm.status()).toBe(409);
  expect((await confirm.json()).error.code).toBe("TRANSACTIONAL_IMPORT_REQUIRED");

  const report = await page.request.get(`${apiBase}/reports/target-data?financialYear=${refs.year.id}&category=E2E-IMPORT`);
  expect(report.status()).toBe(200);
  expect((await report.json()).rows.every((row) => row.actualValue === null)).toBe(true);
});

async function login(page, email, password) {
  const response = await page.request.post(`${apiBase}/auth/login`, {
    headers: { Origin: origin, "Content-Type": "application/json" },
    data: { email, password }
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  await page.goto(body.user.mustChangePassword ? "/change-password" : "/dashboard");
  return body.user;
}

async function logout(page) {
  await page.request.post(`${apiBase}/auth/logout`, {
    headers: { Origin: origin, "X-CSRF-Token": await csrfToken(page) }
  }).catch(() => {});
  await page.context().clearCookies();
  await page.goto("/login");
}

async function changePassword(page, currentPassword, newPassword) {
  await expect(page).toHaveURL(/\/change-password$/);
  await page.getByLabel("Current password").fill(currentPassword);
  await page.getByLabel("New password", { exact: true }).fill(newPassword);
  await page.getByLabel("Confirm new password").fill(newPassword);
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page).toHaveURL(/\/login/);
}

async function csrfToken(page) {
  const cookies = await page.context().cookies(apiBase);
  const csrf = cookies.find((cookie) => cookie.name === "csrfToken");
  expect(csrf?.value).toBeTruthy();
  return decodeURIComponent(csrf.value);
}

async function api(page, method, pathName, csrf, data) {
  const response = await page.request.fetch(`${apiBase}${pathName}`, {
    method,
    headers: { Origin: origin, "X-CSRF-Token": csrf, "Content-Type": "application/json" },
    data
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function loadRefs(page) {
  const [plants, years] = await Promise.all([
    page.request.get(`${apiBase}/master-data/plants?isActive=true&limit=100`).then((response) => response.json()),
    page.request.get(`${apiBase}/master-data/financial-years?isActive=true&limit=100`).then((response) => response.json())
  ]);
  return {
    plantA: plants.rows.find((plant) => plant.code === "PLANT-A"),
    plantB: plants.rows.find((plant) => plant.code === "PLANT-B"),
    year: years.rows.find((year) => year.label === "2026")
  };
}

async function writeImportFile(row) {
  const filePath = path.join(os.tmpdir(), `${e2ePrefix().toLowerCase()}-import.csv`);
  await fs.writeFile(filePath, `plantCode,financialYearLabel,month,metricType,category,materialCode,actualValue,unit,notes\n${row}\n`);
  temporaryFiles.add(filePath);
  return filePath;
}

function e2ePrefix() {
  return `E2E-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`.toUpperCase();
}
