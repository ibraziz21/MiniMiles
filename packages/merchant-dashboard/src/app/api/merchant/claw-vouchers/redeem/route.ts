// POST /api/merchant/claw-vouchers/redeem
//
// Merchant-authenticated claw voucher redemption.
// The merchant scans the QR code; the frontend sends this endpoint the decoded
// payload. We validate the session, validate the payload, delegate the actual
// on-chain markRedeemed call to the react-app relayer (which holds the private
// key and does its own on-chain state checks), then audit the outcome.
//
// Body (QR payload decoded by the merchant POS UI):
//   type        "claw_voucher"
//   voucherId   string  (uint256 as decimal string)
//   owner       string  (0x address)
//   expiresAt   number  (unix seconds)
//
// On success returns: { ok: true, txHash, discountBps, maxValue }
// On failure returns: { error: string } with 4xx/5xx status

import { NextResponse } from "next/server";
import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit";

const REACT_APP_URL    = process.env.REACT_APP_INTERNAL_URL ?? "";
const WEBHOOK_SECRET   = process.env.INTERNAL_WEBHOOK_SECRET ?? "";

// ── QR payload validation ──────────────────────────────────────────────────────

interface ClawQrPayload {
  type:       string;
  voucherId:  string;
  owner:      string;
  expiresAt:  number;
}

function parseQrPayload(body: Record<string, unknown>): ClawQrPayload | string {
  const { type, voucherId, owner, expiresAt } = body;

  if (type !== "claw_voucher") {
    return "payload type must be 'claw_voucher'";
  }
  if (!voucherId || typeof voucherId !== "string" || !/^\d+$/.test(voucherId)) {
    return "voucherId must be a decimal integer string";
  }
  if (!owner || typeof owner !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(owner)) {
    return "owner must be a valid 0x address";
  }
  if (typeof expiresAt !== "number" || !Number.isInteger(expiresAt) || expiresAt <= 0) {
    return "expiresAt must be a positive unix timestamp";
  }

  // Reject payloads that are already expired (before the on-chain check)
  const nowSec = Math.floor(Date.now() / 1000);
  if (expiresAt < nowSec) {
    return "voucher has expired";
  }

  return { type: "claw_voucher", voucherId, owner: owner.toLowerCase(), expiresAt };
}

// ── Guard against duplicate redemptions (DB-level, before hitting chain) ──────

async function isAlreadyRecordedRedeemed(voucherId: string): Promise<boolean> {
  const { data } = await supabase
    .from("claw_voucher_redemptions")
    .select("id")
    .eq("voucher_id", voucherId)
    .eq("success", true)
    .maybeSingle();
  return !!data;
}

// ── Write audit row ────────────────────────────────────────────────────────────

async function writeRedemptionLog(params: {
  merchantUserId: string;
  partnerId: string;
  voucherId: string;
  ownerAddress: string;
  expiresAtUnix: number;
  success: boolean;
  failureReason?: string;
  onChainTxHash?: string;
}): Promise<void> {
  const { error } = await supabase.from("claw_voucher_redemptions").insert({
    merchant_user_id: params.merchantUserId,
    partner_id:       params.partnerId,
    voucher_id:       params.voucherId,
    owner_address:    params.ownerAddress,
    expires_at_unix:  params.expiresAtUnix,
    success:          params.success,
    failure_reason:   params.failureReason ?? null,
    on_chain_tx_hash: params.onChainTxHash ?? null,
  });
  if (error) {
    console.error("[claw-vouchers/redeem] failed to write redemption log", error);
  }
}

// ── Handler ────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  // 1. Require active merchant session
  const session = await requireMerchantSession();
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  // 2. Parse + validate QR payload
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = parseQrPayload(body);
  if (typeof parsed === "string") {
    return NextResponse.json({ error: parsed }, { status: 400 });
  }

  const { voucherId, owner, expiresAt } = parsed;

  // 3. Guard: reject if we already have a successful redemption record for this voucher
  //    (fast path before touching the chain)
  const alreadyRedeemed = await isAlreadyRecordedRedeemed(voucherId);
  if (alreadyRedeemed) {
    await writeRedemptionLog({
      merchantUserId: session.merchantUserId,
      partnerId:      session.partnerId,
      voucherId,
      ownerAddress:   owner,
      expiresAtUnix:  expiresAt,
      success:        false,
      failureReason:  "already_redeemed_in_db",
    });
    return NextResponse.json({ error: "Voucher has already been redeemed" }, { status: 409 });
  }

  // 4. Delegate on-chain markRedeemed to react-app internal relayer endpoint
  //    That endpoint: validates INTERNAL_WEBHOOK_SECRET, re-checks on-chain state
  //    (redeemed, burned, expired), calls markRedeemed, waits for receipt.
  if (!REACT_APP_URL || !WEBHOOK_SECRET) {
    console.error("[claw-vouchers/redeem] REACT_APP_INTERNAL_URL or INTERNAL_WEBHOOK_SECRET not configured");
    return NextResponse.json({ error: "Redemption service not configured" }, { status: 503 });
  }

  let relayerResult: { ok?: boolean; txHash?: string; discountBps?: number; maxValue?: string; error?: string };
  let relayerStatus: number;

  try {
    const relayerResp = await fetch(`${REACT_APP_URL}/api/claw/vouchers/redeem`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-secret": WEBHOOK_SECRET,
      },
      body: JSON.stringify({ voucherId, owner, expiresAt }),
    });

    relayerStatus  = relayerResp.status;
    relayerResult  = await relayerResp.json();
  } catch (fetchErr: any) {
    console.error("[claw-vouchers/redeem] relayer fetch failed", fetchErr?.message);

    await writeRedemptionLog({
      merchantUserId: session.merchantUserId,
      partnerId:      session.partnerId,
      voucherId,
      ownerAddress:   owner,
      expiresAtUnix:  expiresAt,
      success:        false,
      failureReason:  "relayer_unreachable",
    });

    return NextResponse.json({ error: "Redemption service unreachable" }, { status: 503 });
  }

  // 5. Audit the outcome
  const success = relayerResult?.ok === true;

  await writeRedemptionLog({
    merchantUserId: session.merchantUserId,
    partnerId:      session.partnerId,
    voucherId,
    ownerAddress:   owner,
    expiresAtUnix:  expiresAt,
    success,
    failureReason:  success ? undefined : (relayerResult?.error ?? "relayer_error"),
    onChainTxHash:  relayerResult?.txHash,
  });

  // Also write to the generic merchant audit log for dashboard visibility
  void writeAuditLog({
    merchantUserId: session.merchantUserId,
    partnerId:      session.partnerId,
    action:         success ? "claw_voucher.redeemed" : "claw_voucher.redeem_failed",
    metadata: {
      voucher_id:    voucherId,
      owner_address: owner,
      expires_at:    expiresAt,
      tx_hash:       relayerResult?.txHash ?? null,
      error:         success ? null : (relayerResult?.error ?? null),
    },
  });

  // 6. Return relayer result to the caller
  if (!success) {
    return NextResponse.json(
      { error: relayerResult?.error ?? "Redemption failed" },
      { status: relayerStatus >= 400 ? relayerStatus : 422 },
    );
  }

  return NextResponse.json({
    ok:          true,
    txHash:      relayerResult.txHash,
    discountBps: relayerResult.discountBps,
    maxValue:    relayerResult.maxValue,
  });
}
