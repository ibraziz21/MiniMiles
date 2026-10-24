import { describe, expect, it } from "vitest";
import { buildNav, BLOCKED_NAV_ROUTES, type NavNode } from "@/lib/navigation";
import { ADMIN_ROLES, ROLE_PERMISSIONS } from "@/types";

function allRoutes(nodes: NavNode[]): string[] {
  return nodes.flatMap((node) => [node.targetRoute, ...(node.children ? allRoutes(node.children) : [])]);
}

function allRoutesForRole(role: (typeof ADMIN_ROLES)[number]): string[] {
  const nav = buildNav(role);
  return [...allRoutes(nav.desktopPrimary), ...allRoutes(nav.mobileMore)];
}

describe("buildNav — route disposition (blocked legacy links cannot re-enter navigation)", () => {
  for (const role of ADMIN_ROLES) {
    it(`never emits a blocked route for ${role}`, () => {
      const routes = allRoutesForRole(role);
      for (const blocked of BLOCKED_NAV_ROUTES) {
        expect(routes).not.toContain(blocked);
      }
    });
  }

  it("shows Issue voucher whenever the role can grant", () => {
    expect(allRoutesForRole("super_admin")).toContain("/vouchers/grants");
    expect(allRoutesForRole("ops_admin")).toContain("/vouchers/grants");
    expect(allRoutesForRole("finance_admin")).not.toContain("/vouchers/grants");
  });
});

describe("buildNav — navigation construction by role", () => {
  it("shows the complete reimbursable-voucher register to every role with voucher_funds.read", () => {
    for (const role of ADMIN_ROLES) {
      const hasReadPermission = ROLE_PERMISSIONS[role].has("*") || ROLE_PERMISSIONS[role].has("voucher_funds.read");
      const routes = allRoutesForRole(role);
      if (hasReadPermission) {
        expect(routes).toContain("/vouchers/funds");
        expect(routes).toContain("/vouchers/allocations");
        expect(routes).toContain("/vouchers/issued");
      } else {
        expect(routes).not.toContain("/vouchers/funds");
        expect(routes).not.toContain("/vouchers/allocations");
        expect(routes).not.toContain("/vouchers/issued");
      }
    }
  });

  it("gates every role strictly by its own ROLE_PERMISSIONS set — no route appears unless the role has (or wildcards) its permission", () => {
    for (const role of ADMIN_ROLES) {
      const perms = ROLE_PERMISSIONS[role];
      const isWildcard = perms.has("*");
      const nav = buildNav(role);

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
    const routes = allRoutesForRole("insights_admin");
    expect(routes).toContain("/ops-queue");
    expect(routes).not.toContain("/merchants");
    expect(routes).not.toContain("/finance/subscriptions");
  });

  it("ops_admin (no vouchers.read/finance.read) does not see Rewards-hub or Finance destinations", () => {
    const routes = allRoutesForRole("ops_admin");
    expect(routes).not.toContain("/vouchers");
    expect(routes).not.toContain("/vouchers/pricing");
    expect(routes).not.toContain("/finance/subscriptions");
  });

  it("prioritizes Merchants and Vouchers on mobile", () => {
    const nav = buildNav("super_admin");
    expect(nav.mobilePrimary.map((slot) => slot.id)).toEqual(["home", "queue", "merchants", "rewards", "more"]);
    expect(nav.mobileMore.map((node) => node.id)).toContain("pass");
    expect(nav.mobileMore.map((node) => node.id)).toContain("usage");
  });

  it("keeps all five mobile slots useful when a role cannot access Finance", () => {
    const nav = buildNav("ops_admin");
    expect(nav.mobilePrimary.map((slot) => slot.id)).toEqual(["home", "queue", "merchants", "rewards", "more"]);
  });

  it("shows voucher reimbursements whenever the role can read them", () => {
    expect(allRoutes(buildNav("finance_admin").desktopPrimary)).toContain("/finance/voucher-reimbursements");
    expect(allRoutes(buildNav("ops_admin").desktopPrimary)).not.toContain("/finance/voucher-reimbursements");
  });

  it("super_admin sees every desktop primary module", () => {
    const nav = buildNav("super_admin");
    expect(nav.desktopPrimary.map((node) => node.id)).toEqual([
      "home", "work", "merchants", "rewards", "usage", "pass", "finance", "communications", "system", "legacy",
    ]);
  });
});

describe("current and legacy navigation", () => {
  it("groups legacy tools without hiding Pass metrics or current usage", () => {
    const nav = buildNav("super_admin");
    const legacy = nav.desktopPrimary.find(node => node.id === "legacy")!;
    expect(allRoutes([legacy])).toEqual(expect.arrayContaining(["/games/skill-games", "/insights/verified", "/insights/polls"]));
    expect(allRoutes(nav.desktopPrimary.filter(node => node.id !== "legacy"))).not.toContain("/games/skill-games");
    expect(allRoutes(nav.desktopPrimary.filter(node => node.id !== "legacy"))).not.toContain("/insights/verified");
    expect(allRoutes(nav.mobileMore)).toEqual(expect.arrayContaining(["/usage", "/insights/pass", "/verified-visits", "/finance/subscriptions"]));
  });
});
