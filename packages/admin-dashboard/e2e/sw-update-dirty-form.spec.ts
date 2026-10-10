import { test, expect } from "@playwright/test";

// The dirty-state tracking logic itself (src/lib/dirty-state.ts) is unit
// tested in src/__tests__/dirty-state.test.ts. A full "second deployment
// installs → waiting worker → toast → Reload blocked" cycle needs two real
// service worker versions and isn't reliably simulable in a single page
// load, so this verifies the two preconditions that make that flow possible
// in production rather than faking the end-to-end cycle: the service worker
// registers, and the dirty-state hook UpdateAvailableToast reads from is
// wired and reachable from the page.

test.describe("Service worker update readiness", () => {
  test("registers the service worker in production and exposes the dirty-state hook", async ({ page }) => {
    await page.goto("/overview");

    // Registration kicks off on the window "load" event and resolves
    // asynchronously — wait for an active worker rather than racing it.
    const registered = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return Boolean(registration.active);
    });
    expect(registered).toBe(true);

    const hasHook = await page.evaluate(() => typeof window.__akibaAdminSetDirty === "function");
    expect(hasHook).toBe(true);
  });
});
