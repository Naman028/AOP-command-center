import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5174",
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: [
    {
      command: "node scripts/e2e-server.js",
      url: "http://127.0.0.1:4100/health",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        NODE_ENV: "test",
        PORT: "4100",
        HOST: "127.0.0.1",
        CLIENT_ORIGINS: "http://127.0.0.1:5174",
        COOKIE_SECURE: "false",
        MONGODB_URI: ""
      }
    },
    {
      command: "npm run dev --workspace client -- --host 127.0.0.1 --port 5174",
      url: "http://127.0.0.1:5174",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        NODE_ENV: "test",
        VITE_API_BASE_URL: "http://127.0.0.1:4100/api"
      }
    }
  ]
});
