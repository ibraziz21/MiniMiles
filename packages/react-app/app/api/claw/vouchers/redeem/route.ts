// POST /api/claw/vouchers/redeem
//
// INTERNAL endpoint — must only be called by the merchant-dashboard after
// merchant authentication. Protected by INTERNAL_WEBHOOK_SECRET.
//
// This endpoint holds the relayer private key. It:
//   1. Validates the webhook secret (header: x-webhook-secret).
//   2. Validates the QR payload fields passed from the merchant-dashboard.
//   3. Reads on-chain voucher state and verifies:
//      - not already redeemed / burned
//      - not expired
//      - on-chain owner matches payload owner
//   4. Calls markRedeemed on the registry contract.
//   5. Waits for 1-block confirmation.
//
// The merchant-dashboard is responsible for merchant session auth and audit
// logging. This endpoint does NOT check merchant identity.
//
// Body:
//   voucherId   string   (uint256 as decimal string)
//   owner       string   (0x address — must match on-chain owner)
//   expiresAt   number   (unix seconds — must match on-chain expiresAt)

import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http } from "viem";
import { celo } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

// ── Config ─────────────────────────────────────────────────────────────────────
const REGISTRY = (
  process.env.NEXT_PUBLIC_VOUCHER_REGISTRY_ADDRESS ??
  "0xdBFF182cc08e946FF92C5bA575140E41Ea8e63bC"
) as `0x${string}`;
const RPC_URL        = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
const RAW_RELAYER_PK = process.env.CELO_RELAYER_PK ?? process.env.PRIVATE_KEY ?? "";
const RELAYER_PK     = (
  RAW_RELAYER_PK.startsWith("0x") ? RAW_RELAYER_PK : `0x${RAW_RELAYER_PK}`
) as `0x${string}`;
const WEBHOOK_SECRET = process.env.INTERNAL_WEBHOOK_SECRET ?? "";

// ── ABI ────────────────────────────────────────────────────────────────────────
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

// ── Auth helper ────────────────────────────────────────────────────────────────
function isAuthorized(req: Request): boolean {
  if (!WEBHOOK_SECRET) return false;
  return req.headers.get("x-webhook-secret") === WEBHOOK_SECRET;
}

// ── Handler ────────────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  // 1. Internal-only: validate webhook secret
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!RELAYER_PK || RELAYER_PK.length < 10) {
    return NextResponse.json({ error: "Relayer not configured" }, { status: 500 });
  }

  let body: { voucherId?: unknown; owner?: unknown; expiresAt?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { voucherId, owner, expiresAt } = body;

  // 2. Validate required payload fields
  if (!voucherId || typeof voucherId !== "string" || !/^\d+$/.test(voucherId)) {
    return NextResponse.json({ error: "voucherId must be a decimal integer string" }, { status: 400 });
  }
  if (!owner || typeof owner !== "string" || !/^0x[0-9a-fA-F]{40}$/i.test(owner)) {
    return NextResponse.json({ error: "owner must be a valid 0x address" }, { status: 400 });
  }
  if (typeof expiresAt !== "number" || !Number.isInteger(expiresAt) || expiresAt <= 0) {
    return NextResponse.json({ error: "expiresAt must be a positive integer unix timestamp" }, { status: 400 });
  }

  try {
    const vid       = BigInt(voucherId);
    const transport = http(RPC_URL);
    const account   = privateKeyToAccount(RELAYER_PK);
    const pub  = createPublicClient({ chain: celo, transport });
    const wal  = createWalletClient({ chain: celo, transport, account });
    const nowSec = Math.floor(Date.now() / 1000);

    // 3. Read on-chain voucher state
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
    if (Number(v.expiresAt) < nowSec) {
      return NextResponse.json({ error: "Voucher expired" }, { status: 410 });
    }

    // 4. Verify on-chain owner matches the payload owner
    //    This prevents the merchant from redeeming a voucher on behalf of the wrong user.
    if (v.owner.toLowerCase() !== (owner as string).toLowerCase()) {
      return NextResponse.json(
        { error: "Voucher owner does not match payload" },
        { status: 403 },
      );
    }

    // 5. Verify on-chain expiresAt matches payload expiresAt
    //    Prevents a replay where the QR is re-used with a forged future expiresAt.
    if (Number(v.expiresAt) !== expiresAt) {
      return NextResponse.json(
        { error: "Voucher expiresAt does not match payload" },
        { status: 403 },
      );
    }

    // 6. Call markRedeemed on-chain and wait for confirmation
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
      ok:          true,
      txHash:      hash,
      voucherId:   voucherId,
      discountBps: Number(v.discountBps),
      maxValue:    v.maxValue.toString(),
    });
  } catch (err: any) {
    console.error("[claw/vouchers/redeem] unexpected error", err?.message);
    return NextResponse.json({ error: err?.message ?? "Unexpected error" }, { status: 500 });
  }
}
