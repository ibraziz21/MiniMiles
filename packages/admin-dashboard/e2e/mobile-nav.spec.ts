import { test, expect, devices } from "@playwright/test";

test.use({ ...devices["Pixel 7"] });

test.describe("Mobile bottom navigation", () => {
  test("shows exactly 5 labelled destinations", async ({ page }) => {
    await page.goto("/overview");

    const nav = page.getByRole("navigation", { name: "Primary" }).last();
    const items = nav.locator("a, button");
    await expect(items).toHaveCount(5);

    await expect(nav.getByText("Home")).toBeVisible();
    await expect(nav.getByText("Queue")).toBeVisible();
    await expect(nav.getByText("Vouchers")).toBeVisible();
    await expect(nav.getByText("Merchants")).toBeVisible();
    await expect(nav.getByText("More")).toBeVisible();

  });

  test("More opens a full-height sheet, traps focus, and restores focus to the trigger on close", async ({ page }) => {
    await page.goto("/overview");

    const moreButton = page.getByRole("button", { name: "Open more destinations" });
    await moreButton.click();

    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("Merchants")).toBeVisible();
    await sheet.getByText("System", { exact: true }).click();
    await expect(sheet.getByText("Settings", { exact: true })).toBeVisible();
    await sheet.getByText("Legacy", { exact: true }).click();
    await expect(sheet.getByRole("link", { name: "Skill games" })).toBeVisible();
    await expect(sheet.getByRole("link", { name: "Verified insights" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(moreButton).toBeFocused();
  });
});
