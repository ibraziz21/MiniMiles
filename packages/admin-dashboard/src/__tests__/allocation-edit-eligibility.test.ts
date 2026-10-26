import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";
vi.stubGlobal("React", React);
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
import { AllocationForm, type AllocationFormInitial } from "@/components/vouchers/AllocationForm";

const initial: AllocationFormInitial = {
  id: "allocation", version: 1, merchantName: "Arabica", title: "10% off", description: "", termsText: "",
  voucherType: "percent_off", discountKes: 0, discountPercent: 10, maximumDiscountKes: 200,
  minimumSpendKes: 300, quantityCap: 100, authorizedBudgetKes: 20000,
  claimStartsAt: "2026-10-31T00:00:00Z", claimEndsAt: "2026-11-30T00:00:00Z", voucherValidityDays: 2,
  distributionModes: ["self_claim"], recycleExpiredInventory: false,
  eligibilityMode: "all", eligibilityCustomerCopy: "Kenya members, weekends only",
  eligibilityRules: [{ type: "country_in", countries: ["KE"] }, { type: "claim_day_of_week", days: [6, 0], timezone: "Africa/Nairobi" }, { type: "no_prior_merchant_redemption" }],
};
function html(value = initial) {
  return renderToStaticMarkup(React.createElement(AllocationForm, { fundId: "fund", fundCountryCode: "KE", merchants: [], initial: value }));
}
describe("allocation draft eligibility editor", () => {
  it("restores weekend redemption independently from a Monday claim rule", () => {
    const markup = html({ ...initial, eligibilityRules: [{ type: "claim_day_of_week", days: [1] }], redemptionSchedule: { days: [6, 0], timezone: "Africa/Nairobi" } });
    expect(markup).toContain("Redemption schedule");
    expect(markup).toContain("Allowed redemption days");
    expect(markup).toMatch(/checked=""\/>Mon/);
    expect(markup).toMatch(/checked=""\/>Sat/);
    expect(markup).toContain("leave the claim-day eligibility rule unselected");
  });
  it("shows the saved weekend policy and customer copy on edit", () => {
    const markup = html();
    expect(markup).toContain("Eligibility to claim");
    expect(markup).toContain("Kenya members, weekends only");
    expect(markup).toMatch(/checked=""\/>Sun/);
    expect(markup).toMatch(/checked=""\/>Sat/);
    expect(markup).not.toMatch(/checked=""\/>Mon/);
    expect(markup).toContain("they do not restrict when a voucher can be redeemed");
  });
  it("does not replace a saved custom weekday or timezone with weekend defaults", () => {
    const markup = html({ ...initial, eligibilityRules: [{ type: "claim_day_of_week", days: [1], timezone: "Europe/London" }] });
    expect(markup).toMatch(/checked=""\/>Mon/);
    expect(markup).not.toMatch(/checked=""\/>Sat/);
    expect(markup).toContain("Europe/London");
  });
});
