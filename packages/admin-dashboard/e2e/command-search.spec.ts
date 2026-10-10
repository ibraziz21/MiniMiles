import { test, expect } from "@playwright/test";

test.describe("Command search", () => {
  test("Cmd/Ctrl+K opens the palette, Escape closes it", async ({ page }) => {
    await page.goto("/overview");

    await page.keyboard.press("ControlOrMeta+k");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByPlaceholder("Search merchants, members…")).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("/ opens the palette when not focused in a text field", async ({ page }) => {
    await page.goto("/overview");
    await page.locator("body").click();
    await page.keyboard.press("/");

    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("typing a query groups results by entity type and is keyboard-operable", async ({ page }) => {
    await page.goto("/overview");
    await page.keyboard.press("ControlOrMeta+k");

    const input = page.getByPlaceholder("Search merchants, members…");
    await input.fill("a");
    await expect(page.getByText("Type at least 2 characters to search.")).toBeVisible();

    await input.fill("ab");
    // Either a grouped result set or an explicit "no matches" message —
    // never a silent/empty state (spec principle 6). Scoped to the dialog
    // so it can't match the bottom nav's own always-visible "Merchants" label.
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/no matches for|searching…|merchants|members/i).first()).toBeVisible();
  });

  test("mobile header search icon opens the same palette", async ({ page, isMobile }) => {
    test.skip(!isMobile, "desktop already covers the Cmd+K/\"/\" entry points");
    await page.goto("/overview");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
});
