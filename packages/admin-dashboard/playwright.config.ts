import { defineConfig, devices } from "@playwright/test";

const PORT = 3177;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "Desktop Chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "Mobile Chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    // Phase 1 shell specs exercise navigation chrome, PWA metadata, search,
    // and offline behavior independent of any specific admin account — real
    // login credentials aren't seeded in this environment, so the server
    // runs with the documented local/test open-access bypass (see
    // .env.template and src/lib/auth.ts isOpenAccessMode()). login.spec.ts
    // itself only asserts on the login page's own static rendering, which
    // doesn't depend on this flag.
    // Requires `npm run build` to have already produced a production build —
    // run it once before `npx playwright test` (see package.json "e2e" script note).
    command: `npx next start -p ${PORT}`,
    url: baseURL,
    // Never reuse an already-running server at this URL — a stray dev
    // server from an unrelated package once collided here silently and
    // served the wrong app entirely. Always spawn our own, every run.
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ADMIN_OPEN_ACCESS: "true",
      AKIBA_FUNDED_VOUCHERS_ADMIN_ENABLED: "true",
      AKIBA_FUNDED_VOUCHERS_FINANCE_ENABLED: "true",
    },
  },
});
