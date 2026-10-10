import { test, expect } from "@playwright/test";

test.describe("Offline shell", () => {
  test("shows the offline banner and the app shell remains usable when the connection drops", async ({ page, context }) => {
    await page.goto("/overview");
    await expect(page.getByText(/you're offline/i)).toBeHidden();

    await context.setOffline(true);
    // ConnectionStatus listens to the browser's online/offline events.
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));

    await expect(page.getByText(/you're offline.*live data and actions require a connection/i)).toBeVisible();

    // The shell itself (nav, header) stays rendered and usable while offline —
    // only live data/actions are disclaimed, per spec §11.3.
    await expect(page.getByRole("navigation", { name: "Primary" }).first()).toBeVisible();

    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.getByText(/you're offline/i)).toBeHidden();
  });
});
