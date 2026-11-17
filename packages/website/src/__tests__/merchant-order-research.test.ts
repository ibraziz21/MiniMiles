import { describe, expect, it } from "vitest";
import { createResearchSubmissionId, merchantInviteId, questions, validateStep } from "../lib/merchant-order-research";

describe("merchant order research", () => {
  it("keeps payment and delivery questions off the no-remote-orders branch", () => {
    const answers = { channels: ["We don’t take remote orders"], barrier: "Low demand" };
    expect(questions(1, answers).map(({ key }) => key)).toEqual(["channels", "barrier"]);
    expect(validateStep(1, answers)).toBeNull();
  });

  it("validates the visible page before requiring the rest of the section", () => {
    const answers = { channels: ["WhatsApp"] };
    expect(validateStep(1, answers, ["channels"])).toBeNull();
    expect(validateStep(1, answers)?.key).toBe("volume");
  });

  it("requires a discount budget when a merchant needs cost information", () => {
    const answers = {
      intent: "Try it with one or two real orders",
      catalogue: "Take requests without a product list",
      rewards: ["I’d need to understand the cost first"],
    };
    expect(validateStep(2, answers)?.key).toBe("rewardBudget");
    expect(validateStep(2, { ...answers, rewardBudget: "1–3%" })).toBeNull();
    expect(questions(2, { ...answers, rewards: ["No discounts for now"] }).some(({ key }) => key === "rewardBudget")).toBe(false);
  });

  it("creates a valid submission ID with getRandomValues alone", () => {
    const id = createResearchSubmissionId({ getRandomValues: (bytes) => bytes });
    expect(id).toBe("00000000-0000-4000-8000-000000000000");
    expect(merchantInviteId(id)).toBe(id);
  });

  it("accepts UUID invite IDs and rejects other input", () => {
    expect(merchantInviteId("F38941DE-73AC-4E30-94B3-C94DEE8932B4")).toBe("f38941de-73ac-4e30-94b3-c94dee8932b4");
    expect(merchantInviteId("Mtaa Studio")).toBeUndefined();
    expect(merchantInviteId(["F38941DE-73AC-4E30-94B3-C94DEE8932B4"])).toBeUndefined();
  });
});
