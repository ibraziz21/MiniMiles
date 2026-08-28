/**
 * Route-family active-state mapping
 * (akiba-pass-navigation-rewards-earned-notifications-v1-spec.md §3.4).
 * Deliberately table-driven against the exact route-family table in the
 * spec, not `pathname.startsWith(href)`, so a route like /merchants can't
 * accidentally swallow /me.
 */
import { describe, expect, it } from "vitest";
import { resolveActivePrimary } from "@/components/NavLinks";

describe("resolveActivePrimary (§3.4 route-family table)", () => {
  it.each([
    ["/", "explore"],
    ["/merchants", "merchants"],
    ["/merchants/akiba-coffee", "merchants"],
    ["/shop", "merchants"],
    ["/shop/akiba-coffee", "merchants"],
    ["/vouchers", "rewards"],
    ["/vouchers/tmpl-1", "rewards"],
    ["/my-vouchers", "rewards"],
    ["/earn", "earn"],
    ["/quests", "earn"],
    ["/quests/foo", "earn"],
    ["/games", "earn"],
    ["/games/rule-tap", "earn"],
    ["/referrals", "earn"],
    ["/me", "me"],
    ["/me/notifications", "me"],
    ["/pass", null],
    ["/pass/anything", null],
    ["/login", null],
  ] as const)("maps %s -> %s", (pathname, expected) => {
    expect(resolveActivePrimary(pathname)).toBe(expected);
  });

  it("never lets /merchants swallow /me (startsWith trap)", () => {
    expect(resolveActivePrimary("/me")).not.toBe("merchants");
  });
});
