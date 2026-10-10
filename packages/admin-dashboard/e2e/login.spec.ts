import { test, expect } from "@playwright/test";

// The test server runs with ADMIN_OPEN_ACCESS=true (see playwright.config.ts)
// since no real admin credentials are seeded in this environment — that flag
// only affects whether protected routes require a session, not the login
// page itself (always public per middleware's PUBLIC_PATHS), so what's
// testable here is the login form's own rendering/accessibility and its
// error path (an invalid-credentials POST genuinely fails against the real
// backend, no seeded account required). The "successful login redirects to
// ?from=" and "forced password change" journeys (spec §16.2 items 1-2) need
// a real seeded admin account and are skipped with that reason, not faked.

test.describe("Login", () => {
  test("renders email/password fields with password-manager-friendly autocomplete", async ({ page }) => {
    await page.goto("/login");

    const email = page.getByLabel("Email");
    const password = page.getByLabel("Password");

    await expect(email).toHaveAttribute("autocomplete", "email");
    await expect(email).toHaveAttribute("type", "email");
    await expect(password).toHaveAttribute("autocomplete", "current-password");
    await expect(password).toHaveAttribute("type", "password");
  });

  test("shows an inline error for invalid credentials without exposing account existence", async ({ page }) => {
    await page.goto("/login");

    await page.getByLabel("Email").fill("nonexistent-admin@example.com");
    await page.getByLabel("Password").fill("wrong-password-123");
    await page.getByRole("button", { name: /sign in/i }).click();

    const error = page.locator("form p").filter({ hasText: /./ }).last();
    await expect(error).toBeVisible();
    // Precise but non-enumerating — must not say "no such account" (spec §10.10).
    await expect(error).not.toContainText(/no account|does not exist|not found/i);
  });

  test.skip(
    "successful login preserves the ?from= deep link and forced password change redirects to /settings",
    () => {
      // Requires a seeded admin test account (and a must_change_password
      // fixture) not available in this environment. Run against a seeded
      // staging DB once credentials exist.
    },
  );
});
