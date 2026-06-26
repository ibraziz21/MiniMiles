/**
 * POST /api/vouchers/claw
 *
 * Issues a voucher after server-side on-chain verification of a claw win.
 * Chain, contract, and allowed reward classes are loaded from
 * voucher_program_channel_sources — not hardcoded in this file.
 *
 * Checks:
 *   - Source config exists for the supplied program_id + channel=claw
 *   - Session player matches one of the user's linked wallets
 *   - Session status ≥ Settled (2)
 *   - rewardClass is in the program's allowed_reward_classes (default: common+)
 *   - voucherId > 0
 *
 * source_ref: claw:<chainId>:<contractAddress>:<sessionId>:<voucherId>
 */
import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { celo, celoAlfajores } from "viem/chains";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { issueVoucherFromProgram } from "@/lib/vouchers/programs";

const clawGameAbi = [
  {
    inputs: [{ internalType: "uint256", name: "sessionId", type: "uint256" }],
    name: "getSession",
    outputs: [
      {
        components: [
          { internalType: "uint256", name: "sessionId",    type: "uint256" },
          { internalType: "address", name: "player",       type: "address" },
          { internalType: "uint8",   name: "tierId",       type: "uint8"   },
          { internalType: "uint8",   name: "status",       type: "uint8"   },
          { internalType: "uint256", name: "createdAt",    type: "uint256" },
          { internalType: "uint256", name: "settledAt",    type: "uint256" },
          { internalType: "uint256", name: "requestBlock", type: "uint256" },
          { internalType: "uint8",   name: "rewardClass",  type: "uint8"   },
          { internalType: "uint256", name: "rewardAmount", type: "uint256" },
          { internalType: "uint256", name: "voucherId",    type: "uint256" },
        ],
        internalType: "struct AkibaClawGame.GameSession",
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

// SessionStatus: None=0, Pending=1, Settled=2, Claimed=3, Burned=4, Refunded=5
const SESSION_STATUS_SETTLED = 2;

function viemChain(chainId: number) {
  if (chainId === 44787) return celoAlfajores;
  return celo;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const programId = typeof body?.program_id === "string" ? body.program_id.trim() : null;
  const sessionId = typeof body?.session_id === "string" ? body.session_id.trim() : null;

  if (!programId || !sessionId) {
    return NextResponse.json({ error: "Missing program_id or session_id" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Load trusted source config for this program+channel from DB (not hardcoded)
  const { data: sourceConfig } = await admin
    .from("voucher_program_channel_sources")
    .select("chain_id, contract_address, allowed_reward_classes, active")
    .eq("program_id", programId)
    .eq("channel", "claw")
    .maybeSingle();

  if (!sourceConfig || !sourceConfig.active) {
    return NextResponse.json({ error: "No active claw source configured for this program" }, { status: 400 });
  }
  if (!sourceConfig.contract_address || !sourceConfig.chain_id) {
    return NextResponse.json({ error: "Claw source config missing chain or contract" }, { status: 400 });
  }

  const chainId         = sourceConfig.chain_id as number;
  const contractAddress = sourceConfig.contract_address as `0x${string}`;
  // Default allowed classes: Common(2), Rare(3), Epic(4), Legendary(5)
  const allowedClasses  = (sourceConfig.allowed_reward_classes as number[] | null) ?? [2, 3, 4, 5];

  // Load user wallets
  const { data: walletRows } = await admin
    .from("hub_user_wallets")
    .select("address")
    .eq("user_id", user.id);
  const allAddresses = (walletRows ?? []).map((r: { address: string }) => r.address.toLowerCase());

  if (allAddresses.length === 0) {
    return NextResponse.json({ error: "No linked wallet — connect a wallet to claim wins" }, { status: 400 });
  }

  // Verify on-chain session
  let sessionData: { player: `0x${string}`; status: number; rewardClass: number; voucherId: bigint };
  try {
    const pub = createPublicClient({ chain: viemChain(chainId), transport: http() });
    const s = await pub.readContract({
      address: contractAddress,
      abi: clawGameAbi,
      functionName: "getSession",
      args: [BigInt(sessionId)],
    });
    sessionData = {
      player:      s.player,
      status:      Number(s.status),
      rewardClass: Number(s.rewardClass),
      voucherId:   s.voucherId,
    };
  } catch (e) {
    console.error("[claw] on-chain read failed:", e);
    return NextResponse.json({ error: "Could not verify claw session — try again" }, { status: 502 });
  }

  if (sessionData.status < SESSION_STATUS_SETTLED) {
    return NextResponse.json({ error: "Claw session not yet settled" }, { status: 409 });
  }
  if (!allowedClasses.includes(sessionData.rewardClass)) {
    return NextResponse.json({ error: "Reward class not eligible for a voucher in this program" }, { status: 409 });
  }
  if (sessionData.voucherId === 0n) {
    return NextResponse.json({ error: "Session has no voucher ID on-chain" }, { status: 409 });
  }

  const playerLower = sessionData.player.toLowerCase();
  if (!allAddresses.includes(playerLower)) {
    return NextResponse.json({ error: "This win belongs to a different wallet" }, { status: 403 });
  }

  const sourceRef = `claw:${chainId}:${contractAddress.toLowerCase()}:${sessionId}:${sessionData.voucherId.toString()}`;

  const result = await issueVoucherFromProgram({
    programId,
    channel:          "claw",
    sourceRef,
    recipientAddress: playerLower,
    hubUserId:        user.id,
    evidence: {
      session_id:   sessionId,
      chain_id:     chainId,
      contract:     contractAddress,
      reward_class: sessionData.rewardClass,
      voucher_id:   sessionData.voucherId.toString(),
      player:       sessionData.player,
    },
    actorId: user.id,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.httpStatus ?? 500 });
  }
  return NextResponse.json({ voucher_id: result.voucherId, code: result.code }, { status: 201 });
}
