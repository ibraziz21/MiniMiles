import { test, expect } from "@playwright/test";

test.describe("Dashboard priorities", () => {
  for (const width of [320, 375, 414, 768, 1024, 1280, 1440]) {
    test(`Home KPIs and navigation fit at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/overview");
      const metrics = page.getByRole("region", { name: "Key performance indicators" });
      await expect(metrics).toBeVisible();
      for (const label of ["Total Pass users", "New users this week", "Average spend this week", "Total users awarded", "Total miles awarded", "Vouchers redeemed"]) {
        await expect(metrics.getByRole("heading", { name: label, exact: true })).toBeVisible();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const nav = page.locator('nav[aria-label="Primary"]:visible');
      for (const target of await nav.locator("a, button").all()) {
        const box = await target.boundingBox();
        expect(box?.width).toBeGreaterThanOrEqual(44);
        expect(box?.height).toBeGreaterThanOrEqual(44);
      }
      if (width < 1024) {
        for (const label of ["Home", "Queue", "Merchants", "Vouchers"]) {
          const link = nav.getByRole("link", { name: label, exact: true });
          await expect(link).toBeVisible();
          expect(await link.locator("span").last().evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        }
      }
      await page.screenshot({ path: testInfo.outputPath(`home-${width}.png`), fullPage: true });
    });
  }
  test("Legacy and current analytics are reachable from More", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/overview");
    await page.getByRole("button", { name: "Open more destinations" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("link", { name: "Akiba usage" })).toBeVisible();
    await expect(sheet.getByRole("link", { name: "Pass metrics" })).toBeVisible();
    await sheet.getByText("Legacy", { exact: true }).click();
    await expect(sheet.getByRole("link", { name: "Skill games" })).toBeVisible();
    await expect(sheet.getByRole("link", { name: "Verified insights" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Open more destinations" })).toBeFocused();
  });
});
