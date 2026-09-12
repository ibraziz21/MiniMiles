// lib/server/dailyClaimSigner.ts
//
// Server-only EIP-712 signing for daily check-in claim vouchers. Never import
// this from a "use client" file or from lib/dailyQuestClaimer.ts (which must
// stay client-safe). The signing key is dedicated voucher-only authority —
// see docs/daily-checkin-self-claim-spec.md §1 and §10.

import { privateKeyToAccount } from "viem/accounts";
import {
  getDailyClaimDomain,
  QUEST_CLAIM_EIP712_TYPES,
} from "@/lib/dailyQuestClaimer";

function loadSignerKey(): `0x${string}` {
  const raw = process.env.QUEST_VOUCHER_SIGNER_KEY;
  if (!raw) {
    throw new Error(
      "[dailyClaimSigner] QUEST_VOUCHER_SIGNER_KEY is not configured — refusing to fall back to PRIVATE_KEY",
    );
  }
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
}

let _account: ReturnType<typeof privateKeyToAccount> | null = null;

function getVoucherSignerAccount() {
  if (!_account) {
    _account = privateKeyToAccount(loadSignerKey());
  }
  return _account;
}

export function getVoucherSignerAddress(): `0x${string}` {
  return getVoucherSignerAccount().address;
}

export async function signDailyClaimVoucher(opts: {
  user: `0x${string}`;
  amount: bigint;
  dayNonce: bigint;
  deadline: bigint;
  contractAddress: `0x${string}`;
}): Promise<`0x${string}`> {
  const account = getVoucherSignerAccount();
  return account.signTypedData({
    domain: getDailyClaimDomain(opts.contractAddress),
    types: QUEST_CLAIM_EIP712_TYPES,
    primaryType: "QuestClaim",
    message: {
      user: opts.user,
      amount: opts.amount,
      dayNonce: opts.dayNonce,
      deadline: opts.deadline,
    },
  });
}
