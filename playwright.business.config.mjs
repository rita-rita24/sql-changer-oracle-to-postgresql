import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "business-quality.spec.mjs",
  timeout: 30_000,
  workers: 2,
  reporter: [["list"], ["json", { outputFile: "reports/business-browser-latest.json" }]],
  use: { trace: "retain-on-failure" },
  projects: ["chromium", "firefox", "webkit"].map((name) => ({
    name,
    use: {
      browserName: name,
      launchOptions: process.env[`SQL_CHANGER_${name.toUpperCase()}_EXECUTABLE`]
        ? { executablePath: process.env[`SQL_CHANGER_${name.toUpperCase()}_EXECUTABLE`] } : {},
    },
  })),
});
