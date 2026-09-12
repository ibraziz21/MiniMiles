// lib/server/adapters/dailyKilnHoldAdapter.ts
//
// Same eligibility rule as the legacy app/api/quests/daily_kiln_hold/route.ts:
// holding at least KILN_DAILY_MIN_HOLD Kiln share tokens.

import { userErc20BalanceAtLeast } from "@/helpers/erc20Balance";
import { getQuest } from "@/lib/questRegistry";
import { makeDailyEngagementAdapter } from "@/lib/server/adapters/dailyEngagementAdapterFactory";

const KILN_SHARE_TOKEN_ADDRESS = (process.env.KILN_SHARE_TOKEN_ADDRESS ?? "0xbaD4711D689329E315Be3E7C1C64CF652868C56c") as `0x${string}`;
const KILN_SHARE_TOKEN_DECIMALS = Number(process.env.KILN_SHARE_TOKEN_DECIMALS ?? "6");
const KILN_DAILY_MIN_HOLD = Number(process.env.KILN_DAILY_MIN_HOLD ?? "10");

export const dailyKilnHoldAdapter = makeDailyEngagementAdapter({
  family: "daily_kiln_hold",
  loadQuest: () => getQuest("daily_kiln_hold"),
  async checkEligibility(session) {
    const hasRequiredBalance = await userErc20BalanceAtLeast({
      userAddress: session.walletAddress,
      tokenAddress: KILN_SHARE_TOKEN_ADDRESS,
      minAmount: KILN_DAILY_MIN_HOLD,
      decimals: KILN_SHARE_TOKEN_DECIMALS,
    });
    if (!hasRequiredBalance) {
      return {
        ok: false,
        status: 200,
        code: "condition-failed",
        message: `Need at least ${KILN_DAILY_MIN_HOLD} Kiln share tokens (~$${KILN_DAILY_MIN_HOLD}) in your wallet`,
      };
    }
    return { ok: true };
  },
});
