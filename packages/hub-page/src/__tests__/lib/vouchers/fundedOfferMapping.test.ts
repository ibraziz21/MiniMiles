/**
 * The discovery half of percentage funded offers.
 *
 * Both funded-offer loaders used to drop any row whose `discount_kes` was
 * null. A percentage benefit stores no flat amount by design (Akiba-Platform
 * 151 writes discount_kes = NULL so there is never a second, contradictory
 * answer to what the voucher is worth), so every percentage offer vanished
 * from the vouchers grid, the merchant page and all three v1 endpoints — while
 * the database and the claim path were working correctly.
 *
 * toFundedOffer is now the single mapper both loaders call, so these cases
 * cover both surfaces at once.
 */
import { afterEach, describe, it, expect } from "vitest";
import {
  FUNDED_OFFER_TEMPLATE_COLUMNS,
  fundedOffersForV1,
  toFundedOffer,
  type RawFundedPartner,
  type RawFundedTemplate,
} from "@/lib/vouchers/fundedOfferMapping";
import { fundedBenefitLabel } from "@/components/vouchers/FundedOfferCard";

const partner: RawFundedPartner = {
  id: "partner-1",
  name: "Arabica Coffee House",
  slug: "arabica",
  image_url: null,
  status: "active",
};

const percentTemplate: RawFundedTemplate = {
  title: "Weekend 10% off",
  terms_text: null,
  voucher_type: "percent_off",
  discount_kes: null,
  discount_percent: 10,
  maximum_discount_kes: 200,
  minimum_spend_kes: 300,
};

const fixedTemplate: RawFundedTemplate = {
  title: "KES 100 off",
  terms_text: null,
  voucher_type: "fixed_off",
  discount_kes: 100,
  discount_percent: null,
  maximum_discount_kes: null,
  minimum_spend_kes: 1000,
};

function map(template: RawFundedTemplate | null) {
  return toFundedOffer({
    allocationId: "alloc-1",
    claimEndsAt: "2026-11-01T00:00:00.000Z",
    template,
    partner,
    eligibilitySummary: "Kenya members who have not shopped here before",
  });
}

describe("toFundedOffer", () => {
  it("keeps a percentage offer that stores no flat amount", () => {
    const offer = map(percentTemplate);

    expect(offer).not.toBeNull();
    expect(offer!.voucherType).toBe("percent_off");
    expect(offer!.discountPercent).toBe(10);
    expect(offer!.maximumDiscountKes).toBe(200);
    // Deliberately null, not 0 — a zero here would render as "KES 0 off".
    expect(offer!.discountKes).toBeNull();
    expect(offer!.minimumSpendKes).toBe(300);
  });

  it("maps a flat offer unchanged", () => {
    const offer = map(fixedTemplate);

    expect(offer!.voucherType).toBe("fixed_off");
    expect(offer!.discountKes).toBe(100);
    expect(offer!.discountPercent).toBeNull();
    expect(offer!.maximumDiscountKes).toBeNull();
  });

  it("does not leak percentage fields onto a flat offer", () => {
    // A template carrying both (e.g. edited outside the authoring RPC) must
    // not produce an offer that claims to be 10% off AND KES 100 off.
    const offer = map({ ...fixedTemplate, discount_percent: 10, maximum_discount_kes: 200 });

    expect(offer!.voucherType).toBe("fixed_off");
    expect(offer!.discountPercent).toBeNull();
    expect(offer!.maximumDiscountKes).toBeNull();
  });

  it("treats a missing voucher_type as flat, for rows predating the column", () => {
    const offer = map({ ...fixedTemplate, voucher_type: null });

    expect(offer!.voucherType).toBe("fixed_off");
    expect(offer!.discountKes).toBe(100);
  });

  it("still shows a percentage offer whose cap is missing", () => {
    // The claim refuses it with BENEFIT_CONFIGURATION_INVALID, which is a
    // visible failure an operator can act on. Dropping it from discovery
    // instead is the silent failure this whole file exists to prevent.
    const offer = map({ ...percentTemplate, maximum_discount_kes: null });

    expect(offer).not.toBeNull();
    expect(offer!.maximumDiscountKes).toBeNull();
  });

  it.each([
    ["a percentage offer with no percent", { ...percentTemplate, discount_percent: null }],
    ["a flat offer with no amount", { ...fixedTemplate, discount_kes: null }],
    ["any offer with no minimum spend", { ...percentTemplate, minimum_spend_kes: null }],
  ])("drops %s as unrenderable", (_label, template) => {
    expect(map(template as RawFundedTemplate)).toBeNull();
  });

  it("drops a row with no template or no partner", () => {
    expect(map(null)).toBeNull();
    expect(
      toFundedOffer({
        allocationId: "alloc-1",
        claimEndsAt: "2026-11-01T00:00:00.000Z",
        template: percentTemplate,
        partner: null,
        eligibilitySummary: null,
      }),
    ).toBeNull();
  });

  it("selects every column the mapper reads", () => {
    // The loaders share one select fragment precisely so a field cannot be
    // read here but absent from the query — which would silently map to
    // undefined and drop the offer.
    for (const column of [
      "voucher_type",
      "discount_kes",
      "discount_percent",
      "maximum_discount_kes",
      "minimum_spend_kes",
      "title",
      "terms_text",
    ]) {
      expect(FUNDED_OFFER_TEMPLATE_COLUMNS).toContain(column);
    }
  });
});

describe("fundedOffersForV1", () => {
  const percent = map(percentTemplate)!;
  const fixed = map(fixedTemplate)!;

  afterEach(() => {
    delete process.env.AKIBA_PERCENT_FUNDED_OFFERS_V1_ENABLED;
  });

  it("withholds percentage offers from the mobile contract by default", () => {
    // A released build parses discountKes as a required number via
    // schema.parse, and the schema covers the whole catalogue — so one
    // percentage offer breaks the entire response, not one card.
    expect(fundedOffersForV1([percent, fixed])).toEqual([fixed]);
  });

  it("serves them once the flag is on", () => {
    process.env.AKIBA_PERCENT_FUNDED_OFFERS_V1_ENABLED = "true";
    expect(fundedOffersForV1([percent, fixed])).toEqual([percent, fixed]);
  });

  it("never withholds flat offers", () => {
    expect(fundedOffersForV1([fixed])).toEqual([fixed]);
  });

  it("leaves the mapper itself unfiltered, so the web pages still show everything", () => {
    // The filter is applied by the v1 routes, not by the loaders the web
    // pages call — that asymmetry is the whole point of launching on web
    // first.
    expect(map(percentTemplate)).not.toBeNull();
  });
});

describe("fundedBenefitLabel", () => {
  it("states the cap on a percentage offer", () => {
    expect(fundedBenefitLabel(map(percentTemplate)!)).toBe("10% off, up to KES 200");
  });

  it("omits the cap when there is none rather than printing null", () => {
    const offer = map({ ...percentTemplate, maximum_discount_kes: null })!;
    expect(fundedBenefitLabel(offer)).toBe("10% off");
  });

  it("renders a flat offer as a KES amount", () => {
    expect(fundedBenefitLabel(map(fixedTemplate)!)).toBe("KES 100 off");
  });
});
