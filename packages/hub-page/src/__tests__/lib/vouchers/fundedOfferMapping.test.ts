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
  allocationSupportedByV1,
  fundedOffersForV1,
  toFundedOffer,
  type RawFundedPartner,
  type RawFundedTemplate,
} from "@/lib/vouchers/fundedOfferMapping";
import {
  fundedBenefitLabel,
  fundedMerchantLabel,
  isMultiMerchantOffer,
} from "@/components/vouchers/FundedOfferCard";

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

const PRIMARY = { id: "partner-1", name: "Arabica Coffee House", slug: "arabica", imageUrl: null };
const TRADER = { id: "partner-2", name: "Trader B", slug: "trader-b", imageUrl: null };

function map(template: RawFundedTemplate | null, participants = [PRIMARY]) {
  return toFundedOffer({
    participants,
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
        participants: [PRIMARY],
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

describe("participant resolution", () => {
  it("carries the full set, primary first", () => {
    const offer = map(percentTemplate, [PRIMARY, TRADER])!;
    expect(offer.merchants.map((m) => m.id)).toEqual(["partner-1", "partner-2"]);
    // `merchant` stays the primary so existing consumers are unaffected.
    expect(offer.merchant.name).toBe("Arabica Coffee House");
  });

  it("always populates merchants, even for a single-merchant offer", () => {
    // No special case for consumers: length tells them what they have.
    expect(map(percentTemplate)!.merchants).toHaveLength(1);
  });

  it("withholds an offer whose participants could not be resolved", () => {
    // Rule 7: never silently shrink an advertised set or downgrade a
    // multi-merchant offer to single-merchant.
    expect(map(percentTemplate, [])).toBeNull();
    expect(
      toFundedOffer({
        allocationId: "alloc-1",
        claimEndsAt: "2026-11-01T00:00:00.000Z",
        template: percentTemplate,
        partner: { id: "partner-1", name: "A", slug: "a", image_url: null, status: "active" },
        eligibilitySummary: null,
        participants: null,
      }),
    ).toBeNull();
  });

  it("reports multi-merchant status from the set", () => {
    expect(isMultiMerchantOffer(map(percentTemplate)!)).toBe(false);
    expect(isMultiMerchantOffer(map(percentTemplate, [PRIMARY, TRADER])!)).toBe(true);
  });

  it("labels a multi-merchant offer by count, not by one name", () => {
    expect(fundedMerchantLabel(map(percentTemplate, [PRIMARY, TRADER])!)).toBe(
      "Use once at any of 2 merchants",
    );
    expect(fundedMerchantLabel(map(percentTemplate)!)).toBe("Arabica Coffee House");
  });
});

describe("fundedOffersForV1 — the two gates are independent", () => {
  const percentSingle = map(percentTemplate)!;
  const fixedSingle = map(fixedTemplate)!;
  const percentMulti = map(percentTemplate, [PRIMARY, TRADER])!;
  const fixedMulti = map(fixedTemplate, [PRIMARY, TRADER])!;
  const all = [percentSingle, fixedSingle, percentMulti, fixedMulti];

  afterEach(() => {
    delete process.env.AKIBA_PERCENT_FUNDED_OFFERS_V1_ENABLED;
    delete process.env.MULTI_MERCHANT_FUNDED_OFFERS_V1_ENABLED;
  });

  it("off / off → single-merchant fixed only", () => {
    expect(fundedOffersForV1(all)).toEqual([fixedSingle]);
  });

  it("percent on / multi off → no multi-merchant offer leaks through", () => {
    // The regression this exists for: the previous early return handed back
    // every offer the moment percentages were enabled.
    process.env.AKIBA_PERCENT_FUNDED_OFFERS_V1_ENABLED = "true";
    expect(fundedOffersForV1(all)).toEqual([percentSingle, fixedSingle]);
  });

  it("percent off / multi on → percentage offers still withheld", () => {
    process.env.MULTI_MERCHANT_FUNDED_OFFERS_V1_ENABLED = "true";
    expect(fundedOffersForV1(all)).toEqual([fixedSingle, fixedMulti]);
  });

  it("on / on → everything otherwise eligible", () => {
    process.env.AKIBA_PERCENT_FUNDED_OFFERS_V1_ENABLED = "true";
    process.env.MULTI_MERCHANT_FUNDED_OFFERS_V1_ENABLED = "true";
    expect(fundedOffersForV1(all)).toEqual(all);
  });

  it("tolerates a legacy offer with a valid merchant but no merchants array", () => {
    // Such an offer genuinely was single-merchant — nothing could produce a
    // multi-merchant one before the field existed — so it is served, not
    // withheld.
    const legacy = { ...fixedSingle, merchants: undefined } as unknown as typeof fixedSingle;
    expect(fundedOffersForV1([legacy])).toEqual([legacy]);
    expect(isMultiMerchantOffer(legacy)).toBe(false);
  });

  it("withholds a malformed offer carrying neither field", () => {
    // Scope unknown, so it cannot be described honestly to any client.
    const malformed = {
      ...fixedSingle,
      merchant: undefined,
      merchants: undefined,
    } as unknown as typeof fixedSingle;
    expect(fundedOffersForV1([malformed])).toEqual([]);
    expect(allocationSupportedByV1(malformed)).toBe(false);
  });

  it("allocationSupportedByV1 agrees with the catalogue filter", () => {
    // Used by the direct v1 claim route, where hiding an offer from the
    // catalogue is not enough on its own.
    expect(allocationSupportedByV1(fixedSingle)).toBe(true);
    expect(allocationSupportedByV1(fixedMulti)).toBe(false);
    expect(allocationSupportedByV1(percentSingle)).toBe(false);
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
