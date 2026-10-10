import { describe, expect, it } from "vitest";
import { buildNav, BLOCKED_NAV_ROUTES, type NavNode } from "@/lib/navigation";
import { ADMIN_ROLES, ROLE_PERMISSIONS } from "@/types";

function allRoutes(nodes: NavNode[]): string[] {
  return nodes.flatMap((node) => [node.targetRoute, ...(node.children ? allRoutes(node.children) : [])]);
}

function allRoutesForRole(role: (typeof ADMIN_ROLES)[number], fundedVouchersEnabled: boolean): string[] {
  const nav = buildNav(role, fundedVouchersEnabled);
  return [...allRoutes(nav.desktopPrimary), ...allRoutes(nav.mobileMore)];
}

describe("buildNav — route disposition (blocked legacy links cannot re-enter navigation)", () => {
  for (const role of ADMIN_ROLES) {
    for (const fundedVouchersEnabled of [true, false]) {
      it(`never emits a blocked route for ${role} (funded vouchers ${fundedVouchersEnabled ? "on" : "off"})`, () => {
        const routes = allRoutesForRole(role, fundedVouchersEnabled);
        for (const blocked of BLOCKED_NAV_ROUTES) {
          expect(routes).not.toContain(blocked);
        }
      });
    }
  }

  it("shows Issue voucher only when funded vouchers are enabled and the role can grant", () => {
    expect(allRoutesForRole("super_admin", true)).toContain("/vouchers/grants");
    expect(allRoutesForRole("ops_admin", true)).toContain("/vouchers/grants");
    expect(allRoutesForRole("finance_admin", true)).not.toContain("/vouchers/grants");
    expect(allRoutesForRole("super_admin", false)).not.toContain("/vouchers/grants");
  });
});

describe("buildNav — navigation construction by role and feature flag", () => {
  it("shows Funds/Allocations only when the funded-vouchers flag is on AND the role has voucher_funds.read", () => {
    for (const role of ADMIN_ROLES) {
      const hasReadPermission = ROLE_PERMISSIONS[role].has("*") || ROLE_PERMISSIONS[role].has("voucher_funds.read");

      const withFlagOff = allRoutesForRole(role, false);
      expect(withFlagOff).not.toContain("/vouchers/funds");
      expect(withFlagOff).not.toContain("/vouchers/allocations");

      const withFlagOn = allRoutesForRole(role, true);
      if (hasReadPermission) {
        expect(withFlagOn).toContain("/vouchers/funds");
        expect(withFlagOn).toContain("/vouchers/allocations");
      } else {
        expect(withFlagOn).not.toContain("/vouchers/funds");
        expect(withFlagOn).not.toContain("/vouchers/allocations");
      }
    }
  });

  it("gates every role strictly by its own ROLE_PERMISSIONS set — no route appears unless the role has (or wildcards) its permission", () => {
    for (const role of ADMIN_ROLES) {
      const perms = ROLE_PERMISSIONS[role];
      const isWildcard = perms.has("*");
      const nav = buildNav(role, true);

      function assertNode(node: NavNode) {
        if (node.children && node.children.length > 0) {
          node.children.forEach(assertNode);
          return;
        }
        if (node.permission) {
          expect(isWildcard || perms.has(node.permission)).toBe(true);
        }
      }

      nav.desktopPrimary.forEach(assertNode);
      nav.mobileMore.forEach(assertNode);
    }
  });

  it("insights_admin (no merchants.read/finance.read) does not see Merchants or Finance, but does see Work (Queue is permission-filtered per source, not gated at the nav level)", () => {
    const routes = allRoutesForRole("insights_admin", true);
    expect(routes).toContain("/ops-queue");
    expect(routes).not.toContain("/merchants");
    expect(routes).not.toContain("/finance/subscriptions");
  });

  it("ops_admin (no vouchers.read/finance.read) does not see Rewards-hub or Finance destinations", () => {
    const routes = allRoutesForRole("ops_admin", true);
    expect(routes).not.toContain("/vouchers");
    expect(routes).not.toContain("/vouchers/pricing");
    expect(routes).not.toContain("/finance/subscriptions");
  });

  it("prioritizes Rewards and Finance on mobile and relegates Merchants to More", () => {
    const nav = buildNav("super_admin", true);
    expect(nav.mobilePrimary.map((slot) => slot.id)).toEqual(["home", "queue", "rewards", "finance", "more"]);
    expect(nav.mobileMore.map((node) => node.id)).toContain("more-merchants");
  });

  it("keeps all five mobile slots useful when a role cannot access Finance", () => {
    const nav = buildNav("ops_admin", true);
    expect(nav.mobilePrimary.map((slot) => slot.id)).toEqual(["home", "queue", "rewards", "merchants", "more"]);
  });

  it("gates voucher reimbursements independently behind the Finance feature flag", () => {
    expect(allRoutes(buildNav("finance_admin", true, false).desktopPrimary)).not.toContain("/finance/voucher-reimbursements");
    expect(allRoutes(buildNav("finance_admin", false, true).desktopPrimary)).toContain("/finance/voucher-reimbursements");
  });

  it("super_admin sees every desktop primary module", () => {
    const nav = buildNav("super_admin", true);
    expect(nav.desktopPrimary.map((node) => node.id)).toEqual([
      "home",
      "work",
      "rewards",
      "finance",
      "merchants",
      "insights",
      "communications",
      "system",
    ]);
  });
});
