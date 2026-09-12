import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getDailyClaimDomain, QUEST_CLAIM_EIP712_TYPES } from "@/lib/dailyQuestClaimer";

const TEST_SIGNER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TEST_SIGNER_ADDRESS = privateKeyToAccount(TEST_SIGNER_KEY).address;
const CONTRACT = "0xa9e6adb52e74151553c140615a09119d501c75ce" as const;

afterEach(() => {
  delete process.env.QUEST_VOUCHER_SIGNER_KEY;
});

describe("signDailyClaimVoucher", () => {
  it("throws instead of falling back to PRIVATE_KEY when unconfigured", async () => {
    vi.resetModules();
    delete process.env.QUEST_VOUCHER_SIGNER_KEY;
    process.env.PRIVATE_KEY = "0x1111111111111111111111111111111111111111111111111111111111111";
    const { signDailyClaimVoucher } = await import("@/lib/server/dailyClaimSigner");

    await expect(
      signDailyClaimVoucher({
        user: "0x00000000000000000000000000000000000000AA",
        amount: 10n * 10n ** 18n,
        dayNonce: 20708n,
        deadline: 1789257599n,
        contractAddress: CONTRACT,
      }),
    ).rejects.toThrow(/QUEST_VOUCHER_SIGNER_KEY/);

    delete process.env.PRIVATE_KEY;
  });

  it("produces a signature that recovers to the configured signer address", async () => {
    vi.resetModules();
    process.env.QUEST_VOUCHER_SIGNER_KEY = TEST_SIGNER_KEY;
    const { signDailyClaimVoucher, getVoucherSignerAddress } = await import(
      "@/lib/server/dailyClaimSigner"
    );

    expect(getVoucherSignerAddress().toLowerCase()).toBe(TEST_SIGNER_ADDRESS.toLowerCase());

    const message = {
      user: "0x00000000000000000000000000000000000000AA" as const,
      amount: 10n * 10n ** 18n,
      dayNonce: 20708n,
      deadline: 1789257599n,
    };

    const signature = await signDailyClaimVoucher({ ...message, contractAddress: CONTRACT });

    const recovered = await recoverTypedDataAddress({
      domain: getDailyClaimDomain(CONTRACT),
      types: QUEST_CLAIM_EIP712_TYPES,
      primaryType: "QuestClaim",
      message,
      signature,
    });

    expect(recovered.toLowerCase()).toBe(TEST_SIGNER_ADDRESS.toLowerCase());
  });

  it("produces a different signature (and still recovers correctly) for a different contract/domain", async () => {
    vi.resetModules();
    process.env.QUEST_VOUCHER_SIGNER_KEY = TEST_SIGNER_KEY;
    const { signDailyClaimVoucher } = await import("@/lib/server/dailyClaimSigner");

    const message = {
      user: "0x00000000000000000000000000000000000000AA" as const,
      amount: 10n * 10n ** 18n,
      dayNonce: 20708n,
      deadline: 1789257599n,
    };
    const otherContract = "0x00000000000000000000000000000000000000bb" as const;

    const sigA = await signDailyClaimVoucher({ ...message, contractAddress: CONTRACT });
    const sigB = await signDailyClaimVoucher({ ...message, contractAddress: otherContract });

    expect(sigA).not.toBe(sigB);

    const recoveredForA = await recoverTypedDataAddress({
      domain: getDailyClaimDomain(otherContract),
      types: QUEST_CLAIM_EIP712_TYPES,
      primaryType: "QuestClaim",
      message,
      signature: sigA,
    });
    // A signature over one verifyingContract must not verify against another.
    expect(recoveredForA.toLowerCase()).not.toBe(TEST_SIGNER_ADDRESS.toLowerCase());
  });
});
