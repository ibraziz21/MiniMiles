// POST /api/claw/vouchers/redeem
// Merchant-side: verifies voucher is active onchain, marks it redeemed.
import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http } from "viem";
import { celo } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const REGISTRY    = (process.env.NEXT_PUBLIC_VOUCHER_REGISTRY_ADDRESS ?? "0xdBFF182cc08e946FF92C5bA575140E41Ea8e63bC") as `0x${string}`;
const RPC_URL     = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
const RELAYER_PK  = (process.env.CELO_RELAYER_PK ?? process.env.PRIVATE_KEY ?? "") as `0x${string}`;

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
  {
    inputs: [{ name: "voucherId", type: "uint256" }],
    name: "markRedeemed",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { voucherId } = body;

    if (!voucherId) {
      return NextResponse.json({ error: "voucherId required" }, { status: 400 });
    }
    if (!RELAYER_PK || RELAYER_PK.length < 10) {
      return NextResponse.json({ error: "Relayer not configured" }, { status: 500 });
    }

    const vid = BigInt(voucherId);
    const transport = http(RPC_URL);
    const account   = privateKeyToAccount(RELAYER_PK);
    const pub  = createPublicClient({ chain: celo, transport });
    const wal  = createWalletClient({ chain: celo, transport, account });
    const now  = Math.floor(Date.now() / 1000);

    // Verify voucher state
    const v = await pub.readContract({
      address: REGISTRY,
      abi: REGISTRY_ABI,
      functionName: "getVoucher",
      args: [vid],
    }) as any;

    if (v.redeemed) {
      return NextResponse.json({ error: "Voucher already redeemed" }, { status: 409 });
    }
    if (v.burned) {
      return NextResponse.json({ error: "Voucher was burned" }, { status: 409 });
    }
    if (Number(v.expiresAt) < now) {
      return NextResponse.json({ error: "Voucher expired" }, { status: 410 });
    }

    // Mark redeemed onchain
    const hash = await wal.writeContract({
      address: REGISTRY,
      abi: REGISTRY_ABI,
      functionName: "markRedeemed",
      args: [vid],
      account,
      chain: celo,
    });
    await pub.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 60_000 });

    return NextResponse.json({
      ok: true,
      txHash: hash,
      voucherId: voucherId.toString(),
      discountBps: Number(v.discountBps),
      maxValue: v.maxValue.toString(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Unexpected error" }, { status: 500 });
  }
}
