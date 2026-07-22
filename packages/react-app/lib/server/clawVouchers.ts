// Server-only: hydrate a player's Claw vouchers from the chain (session index
// → game contract → voucher registry). Shared by /api/claw/vouchers/user/[address]
// and /api/games/prize-feed — keep the on-chain read logic in one place.

import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";
import clawAbi from "@/contexts/akibaClawGame.json";
import {
  CLAW_SESSIONS_SETUP_MESSAGE,
  isClawSessionsSetupError,
  listClawSessionsForPlayer,
} from "@/lib/server/clawSessions";

const CLAW_GAME = (process.env.NEXT_PUBLIC_CLAW_GAME_ADDRESS ?? "0x32cd4449A49786f8e9C68A5466d46E4dbC5197B3") as `0x${string}`;
const REGISTRY  = (process.env.NEXT_PUBLIC_VOUCHER_REGISTRY_ADDRESS ?? "0xdBFF182cc08e946FF92C5bA575140E41Ea8e63bC") as `0x${string}`;
const RPC_URL   = process.env.CELO_RPC_URL ?? "https://forno.celo.org";

// Minimal AkibaVoucherRegistry ABI — just getVoucher
const REGISTRY_ABI = [
  {
    inputs: [{ name: "voucherId", type: "uint256" }],
    name: "getVoucher",
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "voucherId",   type: "uint256" },
          { name: "owner",       type: "address" },
          { name: "tierId",      type: "uint8"   },
          { name: "rewardClass", type: "uint8"   },
          { name: "discountBps", type: "uint16"  },
          { name: "maxValue",    type: "uint256" },
          { name: "expiresAt",   type: "uint256" },
          { name: "redeemed",    type: "bool"    },
          { name: "burned",      type: "bool"    },
          { name: "merchantId",  type: "bytes32" },
        ],
      },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

export type ClawVoucherResult = {
  voucherId: string;
  sessionId: string;
  owner: string;
  tierId: number;
  rewardClass: number;
  discountBps: number;
  maxValue: string;
  expiresAt: number;
  redeemed: boolean;
  burned: boolean;
  merchantId: string;
  voucherStatus: "active" | "redeemed" | "expired" | "burned";
  /** From the local session index — null if the session predates indexing. */
  createdAt: string | null;
};

export type ClawVouchersLookup =
  | { vouchers: ClawVoucherResult[]; setupRequired?: false; error?: undefined }
  | { vouchers: []; setupRequired: true; error: string }
  | { vouchers: []; setupRequired?: false; error: string };

export async function getClawVouchersForPlayer(address: string, limit = 100): Promise<ClawVouchersLookup> {
  const pub = createPublicClient({ chain: celo, transport: http(RPC_URL) });
  const now = Math.floor(Date.now() / 1000);

  const { sessions, error } = await listClawSessionsForPlayer(address, limit);
  if (error) {
    if (isClawSessionsSetupError(error)) {
      return { vouchers: [], setupRequired: true, error: CLAW_SESSIONS_SETUP_MESSAGE };
    }
    return { vouchers: [], error: error.message };
  }

  if (!sessions.length) {
    return { vouchers: [] };
  }

  const vouchers = await Promise.all(
    sessions.map(async (indexed) => {
      try {
        const sessionId = BigInt(indexed.sessionId);
        const session = await pub.readContract({
          address: CLAW_GAME,
          abi: clawAbi.abi,
          functionName: "getSession",
          args: [sessionId],
        }) as any;

        const owner = String(session.player ?? session[1] ?? "").toLowerCase();
        const voucherId = BigInt((session.voucherId ?? session[9] ?? 0).toString());
        if (owner !== address.toLowerCase() || voucherId === 0n) return null;

        const v = await pub.readContract({
          address: REGISTRY,
          abi: REGISTRY_ABI,
          functionName: "getVoucher",
          args: [voucherId],
        }) as any;

        const expired = Number(v.expiresAt) < now;
        const voucherStatus: ClawVoucherResult["voucherStatus"] = v.burned
          ? "burned"
          : v.redeemed
          ? "redeemed"
          : expired
          ? "expired"
          : "active";

        const result: ClawVoucherResult = {
          voucherId:   voucherId.toString(),
          sessionId:   sessionId.toString(),
          owner:       v.owner,
          tierId:      Number(v.tierId),
          rewardClass: Number(v.rewardClass),
          discountBps: Number(v.discountBps),
          maxValue:    v.maxValue.toString(),
          expiresAt:   Number(v.expiresAt),
          redeemed:    v.redeemed,
          burned:      v.burned,
          merchantId:  v.merchantId,
          voucherStatus,
          createdAt:   indexed.createdAt,
        };
        return result;
      } catch {
        return null;
      }
    })
  );

  return { vouchers: vouchers.filter((v): v is ClawVoucherResult => v !== null) };
}
