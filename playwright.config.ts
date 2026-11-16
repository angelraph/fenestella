import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests against a local dev server, reading the real testnet.
 * No wallet and no mocks: these tests only read.
 *   npx playwright test
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 180_000,
  expect: { timeout: 60_000 },
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3100",
    viewport: { width: 1440, height: 900 },
    launchOptions: process.env.FEN_CHROME ? { executablePath: process.env.FEN_CHROME } : {},
  },
  webServer: {
    command: "npx next dev -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
