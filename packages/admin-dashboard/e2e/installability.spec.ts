import { test, expect } from "@playwright/test";

test.describe("Installability metadata", () => {
  test("exposes manifest link, theme-color, and icons", async ({ page }) => {
    await page.goto("/overview");

    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
    expect(manifestHref).toBeTruthy();

    const manifestRes = await page.request.get(manifestHref!);
    expect(manifestRes.ok()).toBe(true);
    const manifest = await manifestRes.json();
    expect(manifest.name).toBe("AkibaMiles Admin");
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);

    const themeColor = await page.locator('meta[name="theme-color"]').getAttribute("content");
    expect(themeColor?.toLowerCase()).toBe("#0f766e");

    const appleIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
    expect(appleIcon).toContain("apple-touch-icon.png");
  });
});
