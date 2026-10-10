import { test, expect } from "@playwright/test";

test.describe("Keyboard-only shell navigation", () => {
  test("skip link is the first tab stop and focuses main content", async ({ page }) => {
    await page.goto("/overview");

    await page.keyboard.press("Tab");
    const skipLink = page.getByRole("link", { name: "Skip to main content" });
    await expect(skipLink).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
  });

  test("primary rail items are reachable and operable by keyboard with visible focus", async ({ page }) => {
    await page.goto("/overview");

    const financeLink = page.locator('nav[aria-label="Primary"]:visible').getByRole("link", { name: /finance/i });
    await financeLink.focus();
    await expect(financeLink).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/finance/);
  });

  test("client-side route changes move focus to the main landmark without breaking browser back", async ({ page }) => {
    await page.goto("/overview");

    const financeLink = page.locator('nav[aria-label="Primary"]:visible').getByRole("link", { name: /finance/i });
    await financeLink.click();

    await expect(page).toHaveURL(/\/finance/);
    await expect(page.locator("#main-content")).toBeFocused();
    await expect(page.locator("h1")).toHaveCount(1);

    await page.goBack();
    await expect(page).toHaveURL(/\/overview/);
  });
});
