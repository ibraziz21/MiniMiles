import { describe, expect, it } from "vitest";
import { categoryEnabled } from "@/lib/push/dispatch";

const preferences = {
  orders_enabled: true,
  vouchers_enabled: true,
  rewards_enabled: false,
  marketing_enabled: true,
};

describe("push category preferences", () => {
  it("delivers marketing campaigns only when the user explicitly opted in", () => {
    expect(categoryEnabled(preferences, "marketing")).toBe(true);
    expect(categoryEnabled({ ...preferences, marketing_enabled: false }, "marketing")).toBe(false);
    expect(categoryEnabled(null, "marketing")).toBe(false);
  });
});
