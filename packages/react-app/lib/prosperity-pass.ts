// src/lib/prosperity-pass.ts

import { Contract, JsonRpcProvider, ZeroAddress } from "ethers";

/* ───────────────── Types ───────────────── */

export type NounMetadata = {
  background: bigint;
  body: bigint;
  accessory: bigint;
  head: bigint;
  glasses: bigint;
};

export type SuperAccount = {
  smartAccount: string;
  superChainID: string;
  points: bigint;
  level: number;
  noun: NounMetadata;
};

export type SuperAccountCheckResult = {
  hasPassport: boolean;
  account: SuperAccount | null;
};

/* ───────────────── Config ───────────────── */

const SUPERCHAIN_RPC_URL =
  process.env.NEXT_PUBLIC_SUPERCHAIN_RPC_URL || "https://forno.celo.org";

// Default to the Prosperity Pass SuperChainModule address from the docs,
// but allow overriding via env if needed.
const SUPERCHAIN_MODULE_ADDRESS =
  (process.env.NEXT_PUBLIC_SUPERCHAIN_MODULE_ADDRESS as `0x${string}`) ??
  ("0x58f5805b5072C3Dd157805132714E1dF40E79c66" as const);

const SUPERCHAIN_MODULE_ABI = [
  {
    inputs: [{ internalType: "address", name: "_owner", type: "address" }],
    name: "getUserSuperChainAccount",
    outputs: [
      {
        components: [
          { internalType: "address", name: "smartAccount", type: "address" },
          { internalType: "string", name: "superChainID", type: "string" },
          { internalType: "uint256", name: "points", type: "uint256" },
          { internalType: "uint16", name: "level", type: "uint16" },
          {
            components: [
              { internalType: "uint48", name: "background", type: "uint48" },
              { internalType: "uint48", name: "body", type: "uint48" },
              { internalType: "uint48", name: "accessory", type: "uint48" },
              { internalType: "uint48", name: "head", type: "uint48" },
              { internalType: "uint48", name: "glasses", type: "uint48" },
            ],
            internalType: "struct NounMetadata",
            name: "noun",
            type: "tuple",
          },
        ],
        internalType: "struct ISuperChainModule.Account",
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

/* ───────────────── Helper ───────────────── */
function isZero(addr: string | undefined | null): boolean {
  if (!addr) return true;
  return addr.toLowerCase() === ZeroAddress.toLowerCase();
}
/**
 * Fetch the Super Account (Prosperity Pass) data for a given owner address.
 * Returns { hasPassport, account } where `hasPassport` is false if the
 * smartAccount is the zero address.
 */
export async function fetchSuperAccountForOwner(
  owner: string
): Promise<SuperAccountCheckResult> {
  if (!owner) {
    throw new Error("Owner address is required");
  }

  const provider = new JsonRpcProvider(SUPERCHAIN_RPC_URL);

  const superChainModule = new Contract(
    SUPERCHAIN_MODULE_ADDRESS,
    SUPERCHAIN_MODULE_ABI,
    provider
  );

  const rawAccount = await superChainModule.getUserSuperChainAccount(owner);

  const smartAccount: string = rawAccount.smartAccount;
  const superChainID: string = rawAccount.superChainID;
  const points: bigint = rawAccount.points;
  const levelRaw = rawAccount.level as bigint | number;
  const nounRaw = rawAccount.noun as {
    background: bigint;
    body: bigint;
    accessory: bigint;
    head: bigint;
    glasses: bigint;
  };

  const levelBig =
    typeof levelRaw === "bigint" ? levelRaw : BigInt(levelRaw ?? 0);

  // More tolerant detection for legacy users
  const hasPassport =
    !isZero(smartAccount) ||
    (superChainID && superChainID.length > 0) ||
    points > 0n ||
    levelBig > 0n;

  if (!hasPassport) {
    return {
      hasPassport: false,
      account: null,
    };
  }

  const account: SuperAccount = {
    smartAccount,
    superChainID,
    points,
    level: Number(levelBig),
    noun: {
      background: nounRaw.background,
      body: nounRaw.body,
      accessory: nounRaw.accessory,
      head: nounRaw.head,
      glasses: nounRaw.glasses,
    },
  };

  return {
    hasPassport: true,
    account,
  };
}
