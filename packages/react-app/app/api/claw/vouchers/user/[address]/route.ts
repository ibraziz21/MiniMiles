// GET /api/claw/vouchers/user/[address]
// Returns all claw vouchers for a user by reading VoucherIssued events from
// AkibaClawGame and hydrating with registry data.
import { NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";
import clawAbi from "@/contexts/akibaClawGame.json";

const CLAW_GAME    = (process.env.NEXT_PUBLIC_CLAW_GAME_ADDRESS   ?? "0x32cd4449A49786f8e9C68A5466d46E4dbC5197B3") as `0x${string}`;
const REGISTRY     = (process.env.NEXT_PUBLIC_VOUCHER_REGISTRY_ADDRESS ?? "0xdBFF182cc08e946FF92C5bA575140E41Ea8e63bC") as `0x${string}`;
const RPC_URL      = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
const DEPLOY_BLOCK = BigInt(process.env.NEXT_PUBLIC_CLAW_DEPLOY_BLOCK ?? "61599859");

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

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address: rawAddress } = await params;
  const address = rawAddress?.toLowerCase();
  if (!address) {
    return NextResponse.json({ error: "address required" }, { status: 400 });
  }

  const pub = createPublicClient({ chain: celo, transport: http(RPC_URL) });
  const now = Math.floor(Date.now() / 1000);

  try {
    // Scan VoucherIssued events for this player
    const currentBlock = await pub.getBlockNumber();
    const fromBlock    = currentBlock > 50000n ? currentBlock - 50000n : DEPLOY_BLOCK;

    let logs: any[] = [];
    try {
      logs = await pub.getLogs({
        address: CLAW_GAME,
        event: {
          name: "VoucherIssued",
          type: "event",
          inputs: [
            { indexed: true, name: "voucherId",  type: "uint256" },
            { indexed: true, name: "sessionId",  type: "uint256" },
            { indexed: true, name: "owner",      type: "address" },
          ],
        },
        args: { owner: address as `0x${string}` },
        fromBlock,
        toBlock: currentBlock,
      });
    } catch (_e) {
      // Fallback: scan without address filter if RPC doesn't support indexed filters
      logs = await pub.getLogs({
        address: CLAW_GAME,
        event: {
          name: "VoucherIssued",
          type: "event",
          inputs: [
            { indexed: true, name: "voucherId",  type: "uint256" },
            { indexed: true, name: "sessionId",  type: "uint256" },
            { indexed: true, name: "owner",      type: "address" },
          ],
        },
        fromBlock,
        toBlock: currentBlock,
      });
      logs = logs.filter(
        (l) => (l.args?.owner as string)?.toLowerCase() === address
      );
    }

    if (!logs.length) {
      return NextResponse.json({ vouchers: [] });
    }

    // Hydrate each voucher from registry
    const vouchers = await Promise.all(
      logs.map(async (l) => {
        const voucherId  = (l.args as any).voucherId  as bigint;
        const sessionId  = (l.args as any).sessionId  as bigint;

        try {
          const v = await pub.readContract({
            address: REGISTRY,
            abi: REGISTRY_ABI,
            functionName: "getVoucher",
            args: [voucherId],
          }) as any;

          const expired    = Number(v.expiresAt) < now;
          const voucherStatus = v.burned
            ? "burned"
            : v.redeemed
            ? "redeemed"
            : expired
            ? "expired"
            : "active";

          return {
            voucherId:     voucherId.toString(),
            sessionId:     sessionId.toString(),
            owner:         v.owner,
            tierId:        Number(v.tierId),
            rewardClass:   Number(v.rewardClass),
            discountBps:   Number(v.discountBps),
            maxValue:      v.maxValue.toString(),
            expiresAt:     Number(v.expiresAt),
            redeemed:      v.redeemed,
            burned:        v.burned,
            merchantId:    v.merchantId,
            voucherStatus,
          };
        } catch (_e) {
          return null;
        }
      })
    );

    return NextResponse.json({
      vouchers: vouchers.filter(Boolean),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Failed" }, { status: 500 });
  }
}
