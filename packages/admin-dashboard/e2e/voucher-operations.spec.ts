import { expect, test } from "@playwright/test";

const RESPONSIVE_WIDTHS = [320, 375, 414, 768, 1024, 1280, 1440] as const;

test.describe("Reimbursable voucher operations", () => {
  test("exposes the complete permissioned rewards navigation without a feature gate", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/vouchers");

    const rewardsNav = page.getByRole("navigation", { name: "Rewards navigation" });
    const reimbursableGroup = rewardsNav.getByRole("button", { name: "Reimbursable vouchers" });
    if (await reimbursableGroup.getAttribute("aria-expanded") !== "true") await reimbursableGroup.click();

    await expect(rewardsNav.getByRole("link", { name: "Voucher funds" })).toBeVisible();
    await expect(rewardsNav.getByRole("link", { name: "Merchant allocations" })).toBeVisible();
    await expect(rewardsNav.getByRole("link", { name: "Issued vouchers" })).toBeVisible();
    await expect(rewardsNav.getByRole("link", { name: "Issue voucher" })).toBeVisible();
  });

  test("keeps fund, allocation, issuance, register, and reimbursement surfaces available", async ({ page }) => {
    const routes = [
      ["/vouchers/funds", "Funds"],
      ["/vouchers/allocations", "Allocations"],
      ["/vouchers/grants", "Issue voucher"],
      ["/vouchers/issued", "Issued vouchers"],
      ["/finance/voucher-reimbursements", "Voucher reimbursements"],
    ] as const;

    for (const [route, heading] of routes) {
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await expect(page.getByText(/disabled by.*feature flag|issuance is currently paused/i)).toHaveCount(0);
    }
  });

  test("keeps the voucher register usable at every supported viewport", async ({ page }) => {
    for (const width of RESPONSIVE_WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/vouchers/issued");
      await expect(page.getByRole("heading", { level: 1, name: "Issued vouchers" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  });

  test("preserves logical keyboard order across issued-voucher filters", async ({ page }) => {
    await page.goto("/vouchers/issued");

    const recipient = page.getByLabel("Recipient", { exact: true });
    const state = page.getByLabel("State", { exact: true });
    await recipient.focus();
    await expect(recipient).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(state).toBeFocused();
  });
});
