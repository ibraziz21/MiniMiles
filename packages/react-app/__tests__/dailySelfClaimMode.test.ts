import { describe, expect, it } from "vitest";
import { getFamilySelfClaimMode, isSelfClaimEnabledForWallet } from "@/lib/server/dailySelfClaimMode";

describe("getFamilySelfClaimMode", () => {
  it("defaults to off (fail closed) for a family absent from QUEST_SELF_CLAIM_FAMILIES", () => {
    expect(getFamilySelfClaimMode("daily_transfer", {})).toBe("off");
  });

  it("applies the generic policy once the family is listed", () => {
    const env = { QUEST_SELF_CLAIM_MODE: "on", QUEST_SELF_CLAIM_FAMILIES: "daily_transfer,daily_receive" };
    expect(getFamilySelfClaimMode("daily_transfer", env)).toBe("on");
    expect(getFamilySelfClaimMode("daily_receive", env)).toBe("on");
    expect(getFamilySelfClaimMode("daily_kiln_hold", env)).toBe("off"); // not listed
  });

  it("rejects an unknown mode value as off", () => {
    expect(
      getFamilySelfClaimMode("daily_transfer", {
        QUEST_SELF_CLAIM_MODE: "banana",
        QUEST_SELF_CLAIM_FAMILIES: "daily_transfer",
      }),
    ).toBe("off");
  });

  it("recognizes allowlist and on, case-insensitively", () => {
    const families = "daily_transfer";
    expect(
      getFamilySelfClaimMode("daily_transfer", { QUEST_SELF_CLAIM_MODE: "ALLOWLIST", QUEST_SELF_CLAIM_FAMILIES: families }),
    ).toBe("allowlist");
    expect(
      getFamilySelfClaimMode("daily_transfer", { QUEST_SELF_CLAIM_MODE: "on", QUEST_SELF_CLAIM_FAMILIES: families }),
    ).toBe("on");
  });

  it("falls back to DAILY_SELF_CLAIM_MODE for daily_checkin only, when it isn't listed in QUEST_SELF_CLAIM_FAMILIES", () => {
    expect(getFamilySelfClaimMode("daily_checkin", { DAILY_SELF_CLAIM_MODE: "on" })).toBe("on");
    // The legacy var must never leak into an unrelated family.
    expect(getFamilySelfClaimMode("daily_transfer", { DAILY_SELF_CLAIM_MODE: "on" })).toBe("off");
  });

  it("prefers the generic policy over the legacy daily var once daily_checkin is migrated", () => {
    const env = {
      DAILY_SELF_CLAIM_MODE: "off",
      QUEST_SELF_CLAIM_MODE: "on",
      QUEST_SELF_CLAIM_FAMILIES: "daily_checkin",
    };
    expect(getFamilySelfClaimMode("daily_checkin", env)).toBe("on");
  });
});

describe("isSelfClaimEnabledForWallet", () => {
  it("is disabled for everyone when the family's mode is off", () => {
    expect(isSelfClaimEnabledForWallet("daily_transfer", "0xabc", {})).toBe(false);
  });

  it("is enabled for everyone in on mode", () => {
    const env = { QUEST_SELF_CLAIM_MODE: "on", QUEST_SELF_CLAIM_FAMILIES: "daily_transfer" };
    expect(isSelfClaimEnabledForWallet("daily_transfer", "0xabc", env)).toBe(true);
  });

  it("only enables allowlisted wallets (case/whitespace-insensitive) in allowlist mode", () => {
    const env = {
      QUEST_SELF_CLAIM_MODE: "allowlist",
      QUEST_SELF_CLAIM_FAMILIES: "daily_transfer",
      QUEST_SELF_CLAIM_ALLOWLIST: " 0xAbC, 0xDef ",
    };
    expect(isSelfClaimEnabledForWallet("daily_transfer", "0xabc", env)).toBe(true);
    expect(isSelfClaimEnabledForWallet("daily_transfer", "0xDEF", env)).toBe(true);
    expect(isSelfClaimEnabledForWallet("daily_transfer", "0x123", env)).toBe(false);
  });

  it("keeps daily_checkin's legacy DAILY_SELF_CLAIM_ALLOWLIST working while unmigrated", () => {
    const env = { DAILY_SELF_CLAIM_MODE: "allowlist", DAILY_SELF_CLAIM_ALLOWLIST: "0xabc" };
    expect(isSelfClaimEnabledForWallet("daily_checkin", "0xabc", env)).toBe(true);
    expect(isSelfClaimEnabledForWallet("daily_checkin", "0xdef", env)).toBe(false);
  });

  it("keeps every family independent of one another", () => {
    const env = { QUEST_SELF_CLAIM_MODE: "on", QUEST_SELF_CLAIM_FAMILIES: "daily_transfer" };
    expect(isSelfClaimEnabledForWallet("daily_transfer", "0xabc", env)).toBe(true);
    expect(isSelfClaimEnabledForWallet("daily_receive", "0xabc", env)).toBe(false);
  });
});
