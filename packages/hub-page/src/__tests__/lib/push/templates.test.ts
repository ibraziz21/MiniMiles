/**
 * Unit tests for the referral push templates added for
 * referral-system-spec.md §12 — verifies the exact required copy and that
 * every template renders (renderTemplate returns null for unknown
 * templates, which is how process-push-jobs suppresses a job it can't
 * render — a typo here would silently suppress every referral push).
 */
import { describe, it, expect } from "vitest";
import { renderTemplate } from "@/lib/push/templates";

describe("renderTemplate — referral templates", () => {
  it("renders referral_signup_held with the exact required copy", () => {
    expect(renderTemplate("referral_signup_held")).toEqual({
      title: "Friend joined!",
      body: "A friend joined with your invite. 50 Miles are pending.",
    });
  });

  it("renders referral_signup_released with the exact required copy", () => {
    expect(renderTemplate("referral_signup_released")).toEqual({
      title: "Miles earned",
      body: "You earned 50 Miles for a referral.",
    });
  });

  it("renders referral_activation_held with the exact required copy", () => {
    expect(renderTemplate("referral_activation_held")).toEqual({
      title: "Friend became active!",
      body: "Your friend became active. 100 Miles are pending.",
    });
  });

  it("renders referral_activation_released with the exact required copy", () => {
    expect(renderTemplate("referral_activation_released")).toEqual({
      title: "Referral complete!",
      body: "You earned another 100 Miles. Referral complete!",
    });
  });

  it("renders referral_manual_review with the exact required copy", () => {
    expect(renderTemplate("referral_manual_review")).toEqual({
      title: "Reward under review",
      body: "A referral reward needs more time for review.",
    });
  });

  it("never identifies a merchant, purchase, or voucher in any referral template", () => {
    const templates = [
      "referral_signup_held",
      "referral_signup_released",
      "referral_activation_held",
      "referral_activation_released",
      "referral_manual_review",
    ];
    for (const t of templates) {
      const rendered = renderTemplate(t);
      expect(rendered).not.toBeNull();
      const text = `${rendered!.title} ${rendered!.body}`.toLowerCase();
      expect(text).not.toMatch(/merchant|voucher|purchase|order/);
    }
  });

  it("uses the reward amount pinned to the referral program version", () => {
    expect(renderTemplate("referral_signup_released", { amountMiles: 75 })).toEqual({
      title: "Miles earned",
      body: "You earned 75 Miles for a referral.",
    });
    expect(renderTemplate("referral_activation_held", { amountMiles: 125 })).toEqual({
      title: "Friend became active!",
      body: "Your friend became active. 125 Miles are pending.",
    });
  });

  it("returns null for an unknown template", () => {
    expect(renderTemplate("not_a_real_template")).toBeNull();
  });
});

describe("renderTemplate — contribution_requested", () => {
  it("asks about the named place", () => {
    expect(renderTemplate("contribution_requested", { merchantName: "Kahawa Corner" })).toEqual({
      title: "How was Kahawa Corner?",
      body: "Share a quick recommendation to help other Akiba members find good places.",
    });
  });

  it("falls back to a generic title without a merchant name", () => {
    expect(renderTemplate("contribution_requested", {})?.title).toBe("How was your visit?");
  });
});

describe("renderTemplate — saved_place_offer", () => {
  it("names the place and the offer", () => {
    expect(renderTemplate("saved_place_offer", { merchantName: "Kahawa Corner", offerTitle: "20% off brunch" })).toEqual({
      title: "New offer at Kahawa Corner",
      body: "20% off brunch",
    });
  });

  it("still reads well with nothing to name", () => {
    expect(renderTemplate("saved_place_offer", {})).toEqual({
      title: "New offer at a place you saved",
      body: "A place you saved has a new offer. Open Akiba to see it.",
    });
  });
});

describe("renderTemplate — voucher_expiring", () => {
  // 12:00 on 10 Nov in Nairobi (UTC+3).
  const NOW = Date.parse("2026-11-10T09:00:00Z");

  it("says tomorrow, in Nairobi time", () => {
    expect(
      renderTemplate(
        "voucher_expiring",
        { count: 1, title: "25% off", merchantName: "Kahawa Corner", expiresAt: "2026-11-11T07:00:00+00:00" },
        NOW,
      ),
    ).toEqual({ title: "Your voucher expires tomorrow", body: "25% off at Kahawa Corner: use it before 10:00 am." });
  });

  it("says today when it ends later the same Nairobi day", () => {
    const rendered = renderTemplate("voucher_expiring", { count: 1, title: "25% off", expiresAt: "2026-11-10T17:30:00Z" }, NOW);
    expect(rendered).toEqual({ title: "Your voucher expires today", body: "25% off: use it before 8:30 pm." });
  });

  it("covers several vouchers in one push", () => {
    const rendered = renderTemplate("voucher_expiring", { count: 3, expiresAt: "2026-11-10T17:30:00Z" }, NOW);
    expect(rendered).toEqual({
      title: "3 vouchers expire soon",
      body: "The first one ends today at 8:30 pm. Open Akiba to use them in time.",
    });
  });

  it("falls back when the expiry is missing", () => {
    expect(renderTemplate("voucher_expiring", {}, NOW)).toEqual({
      title: "Your voucher expires soon",
      body: "Your voucher: use it before it expires.",
    });
  });
});

describe("renderTemplate — announcement templates", () => {
  it.each(["feature_announcement", "merchant_announcement", "general_announcement"])(
    "renders safe admin-authored copy for %s",
    (template) => {
      expect(renderTemplate(template, { title: "Fresh at Akiba", body: "See what just landed." })).toEqual({
        title: "Fresh at Akiba",
        body: "See what just landed.",
      });
    },
  );

  it("rejects missing or oversized announcement copy", () => {
    expect(renderTemplate("feature_announcement", { title: "", body: "Body" })).toBeNull();
    expect(renderTemplate("feature_announcement", { title: "Title", body: "x".repeat(161) })).toBeNull();
  });

  it("renders the previously allowlisted refund_failed template", () => {
    expect(renderTemplate("refund_failed")).toEqual({
      title: "Refund needs attention",
      body: "Open Akiba to review your refund status.",
    });
  });
});

describe("renderTemplate — miles_earned (§6.5 copy states)", () => {
  it("renders the 'progress remains' state from a stored nextReward snapshot", () => {
    expect(
      renderTemplate("miles_earned", {
        amountMiles: 120,
        merchantName: "Merchant X",
        nextReward: { templateId: "t1", benefitLabel: "10% off", merchantName: "Merchant Z", gapMiles: 80, affordable: false },
      }),
    ).toEqual({
      title: "You earned 120 Miles 🎉",
      body: "From Merchant X. Only 80 more to unlock 10% off.",
    });
  });

  it("renders the 'reward unlocked' state when the snapshot says affordable", () => {
    expect(
      renderTemplate("miles_earned", {
        amountMiles: 120,
        merchantName: "Merchant X",
        nextReward: { templateId: "t1", benefitLabel: "10% off", merchantName: "Merchant Z", gapMiles: 0, affordable: true },
      }),
    ).toEqual({
      title: "Reward unlocked 🎉",
      body: "Your 120 Miles from Merchant X unlocked 10% off at Merchant Z.",
    });
  });

  it("renders the generic 'no usable progress' state when nextReward is null", () => {
    expect(renderTemplate("miles_earned", { amountMiles: 120, merchantName: "Merchant X", nextReward: null })).toEqual({
      title: "You earned 120 Miles 🎉",
      body: "Your purchase at Merchant X added Miles to your balance.",
    });
  });

  it("never mentions purchase amount or purchased items", () => {
    const rendered = renderTemplate("miles_earned", {
      amountMiles: 120,
      merchantName: "Merchant X",
      nextReward: null,
    })!;
    const text = `${rendered.title} ${rendered.body}`.toLowerCase();
    expect(text).not.toMatch(/kes|cusd|\$|amount paid|receipt/);
  });

  it("degrades safely for missing/malformed metadata instead of throwing", () => {
    expect(renderTemplate("miles_earned", {})).toEqual({
      title: "You earned 0 Miles 🎉",
      body: "Your purchase at an Akiba merchant added Miles to your balance.",
    });
  });
});
