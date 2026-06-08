import { createWalletClient, http } from "viem";
import { celo } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const CELO_RPC = process.env.CELO_RPC_URL ?? "https://forno.celo.org";

const DAILY_QUEST_CLAIMER_ADDRESS = (
  process.env.DAILY_QUEST_CLAIMER_ADDRESS ?? ""
) as `0x${string}`;

// The contract domain — must match DailyQuestClaimer constructor args exactly.
const domain = {
  name: "DailyQuestClaimer",
  version: "1",
  chainId: celo.id,
  verifyingContract: DAILY_QUEST_CLAIMER_ADDRESS,
} as const;

const types = {
  QuestClaim: [
    { name: "user",     type: "address" },
    { name: "amount",   type: "uint256" },
    { name: "dayNonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export function currentDayNonce(): bigint {
  return BigInt(Math.floor(Date.now() / 86_400_000));
}

/** Voucher expires at the end of the current UTC day (midnight UTC). */
export function todayDeadline(): bigint {
  const now = new Date();
  const endOfDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  );
  return BigInt(Math.floor(endOfDay.getTime() / 1000));
}

export async function signDailyQuestVoucher(opts: {
  user: `0x${string}`;
  amountMiles: number;
}): Promise<{
  amount: string;
  dayNonce: string;
  deadline: string;
  signature: `0x${string}`;
  contractAddress: string;
}> {
  const pk = process.env.QUEST_VOUCHER_SIGNER_KEY ?? process.env.PRIVATE_KEY;
  if (!pk) throw new Error("QUEST_VOUCHER_SIGNER_KEY not set");
  if (!DAILY_QUEST_CLAIMER_ADDRESS) throw new Error("DAILY_QUEST_CLAIMER_ADDRESS not set");

  const account = privateKeyToAccount(
    (pk.startsWith("0x") ? pk : `0x${pk}`) as `0x${string}`
  );
  const walletClient = createWalletClient({ account, chain: celo, transport: http(CELO_RPC) });

  // AkibaMiles uses 18 decimals
  const amount   = BigInt(opts.amountMiles) * BigInt(10 ** 18);
  const dayNonce = currentDayNonce();
  const deadline = todayDeadline();

  const signature = await walletClient.signTypedData({
    account,
    domain,
    types,
    primaryType: "QuestClaim",
    message: { user: opts.user, amount, dayNonce, deadline },
  });

  return {
    amount:          amount.toString(),
    dayNonce:        dayNonce.toString(),
    deadline:        deadline.toString(),
    signature,
    contractAddress: DAILY_QUEST_CLAIMER_ADDRESS,
  };
}
