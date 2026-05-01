import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e-browser",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.APP_BASE_URL ?? "http://localhost:3000",
    headless: true,
    viewport: { width: 1280, height: 800 },
    actionTimeout: 10_000,
    trace: "retain-on-failure",
  },
});
