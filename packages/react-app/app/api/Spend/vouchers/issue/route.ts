// POST /api/Spend/vouchers/issue
// Burns AkibaMiles and issues a spend voucher.
//
// Body:
//   merchant_id       string  (UUID)
//   template_id       string  (UUID)
//   user_address      string  (checksummed or lowercase)
//   timestamp         number  (unix seconds)
//   nonce             string  (random per-request string)
//   signature         string  (0x... personal_sign over the canonical message)
//   idempotency_key   string  (frontend retry key — same key returns the same voucher)
//
// Concurrency safety:
//   reserve_voucher_atomic() (SECURITY DEFINER SQL function) acquires a
//   pg_advisory_xact_lock on the template_id so cap and cooldown checks are
//   serialized across all concurrent requests.  The nonce INSERT before it
//   serializes per-(user, nonce) pair.

import { NextResponse } from "next/server";
import { verifyMessage } from "viem";
import { supabase } from "@/lib/supabaseClient";
import { safeBurnMiniPoints } from "@/lib/minipoints";
import { isBlacklisted } from "@/lib/blacklist";

const NONCE_WINDOW_SEC = 10 * 60; // 10 minutes

/** Canonical message the frontend must sign. */
function buildSignMessage(
  merchant_id: string,
  template_id: string,
  user_address: string,
  timestamp: number,
  nonce: string,
): string {
  return `AkibaVoucher:${merchant_id}:${template_id}:${user_address.toLowerCase()}:${timestamp}:${nonce}`;
}

function generateVoucherCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 chars — no I/O/1/0
  const charsLen = chars.length; // 32 = 2^5, so no modulo bias
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let code = "";
  for (let i = 0; i < 10; i++) {
    // 256 % 32 === 0, so every byte maps uniformly — no bias.
    code += chars[bytes[i] % charsLen];
  }
  return code;
}

// ── Map RPC exception message prefix → HTTP status ────────────────────────────
function mapRpcError(message: string): { status: number; error: string } {
  if (message.startsWith("CAP_EXCEEDED")) {
    return { status: 409, error: "Voucher supply exhausted" };
  }
  if (message.startsWith("COOLDOWN_ACTIVE")) {
    return { status: 429, error: "Cooldown active for this voucher template" };
  }
  if (message.startsWith("TEMPLATE_INACTIVE")) {
    return { status: 404, error: "Template not found or inactive" };
  }
  return { status: 500, error: "Failed to reserve voucher" };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { merchant_id, template_id, user_address, timestamp, nonce, signature, idempotency_key } = body;

    // ── Basic validation ──────────────────────────────────────────────────────
    if (
      !merchant_id || !template_id || !user_address ||
      !timestamp || !nonce || !signature
    ) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (await isBlacklisted(user_address, "Spend/vouchers/issue")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const addr = user_address.toLowerCase() as `0x${string}`;

    // ── Idempotency check ─────────────────────────────────────────────────────
    if (idempotency_key) {
      const { data: existing } = await supabase
        .from("issued_vouchers")
        .select("id, code, qr_payload, status")
        .eq("idempotency_key", idempotency_key)
        .maybeSingle();

      if (existing) return NextResponse.json({ voucher: existing });
    }

    // ── Timestamp freshness ───────────────────────────────────────────────────
    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - timestamp) > NONCE_WINDOW_SEC) {
      return NextResponse.json({ error: "Signature expired" }, { status: 400 });
    }

    // ── Signature verification ────────────────────────────────────────────────
    const message = buildSignMessage(merchant_id, template_id, user_address, timestamp, nonce);
    const valid = await verifyMessage({ address: addr, message, signature });
    if (!valid) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    // ── Claim nonce atomically (UNIQUE constraint serializes concurrent requests)
    // This is the first write; the DB UNIQUE constraint on (nonce) means concurrent
    // requests with the same nonce are rejected here before cap/cooldown or burns happen.
    const { error: nonceErr } = await supabase
      .from("voucher_issue_nonces")
      .insert({ nonce, user_address: addr, used_at: new Date().toISOString() });

    if (nonceErr) {
      // unique violation → nonce already used (or DB error)
      return NextResponse.json({ error: "Nonce already used" }, { status: 400 });
    }

    // ── Atomically reserve pending voucher (cap + cooldown + insert) ──────────
    // reserve_voucher_atomic() acquires pg_advisory_xact_lock(template_id) so
    // all concurrent requests for this template queue here. Cap and cooldown are
    // checked and the pending row is inserted in a single serialized transaction.
    // Any violation raises a structured exception with a typed prefix.
    const code = generateVoucherCode();
    const qr_payload = JSON.stringify({ code, merchant_id, voucher_template_id: template_id, user: addr });

    const { data: reserved, error: rpcErr } = await supabase.rpc("reserve_voucher_atomic", {
      p_template_id:     template_id,
      p_user_address:    addr,
      p_merchant_id:     merchant_id,
      p_code:            code,
      p_qr_payload:      qr_payload,
      p_idempotency_key: idempotency_key ?? null,
    });

    if (rpcErr || !reserved || reserved.length === 0) {
      const msg = rpcErr?.message ?? "";
      console.error("[vouchers/issue] reserve_voucher_atomic failed", msg);
      const { status, error } = mapRpcError(msg);
      return NextResponse.json({ error }, { status });
    }

    const pendingVoucher = reserved[0] as {
      voucher_id: string;
      code: string;
      qr_payload: string;
      status: string;
      miles_cost: number;
    };

    // ── Burn miles ────────────────────────────────────────────────────────────
    let burnTxHash: string;
    try {
      burnTxHash = await safeBurnMiniPoints({
        from: addr,
        points: pendingVoucher.miles_cost,
        reason: `voucher-issue:template_${template_id}`,
      });
    } catch (burnErr: any) {
      console.error("[vouchers/issue] burn failed — voiding pending voucher", burnErr);

      // Void the pre-inserted row so it doesn't count toward cap or cooldown
      await supabase
        .from("issued_vouchers")
        .update({ status: "void" })
        .eq("id", pendingVoucher.voucher_id);

      return NextResponse.json(
        { error: burnErr?.shortMessage ?? "Miles burn failed" },
        { status: 422 },
      );
    }

    // ── Promote voucher to issued ─────────────────────────────────────────────
    const { data: voucher, error: promoteErr } = await supabase
      .from("issued_vouchers")
      .update({ status: "issued", burn_tx_hash: burnTxHash })
      .eq("id", pendingVoucher.voucher_id)
      .select("id, code, qr_payload, status")
      .single();

    if (promoteErr || !voucher) {
      // Burn is confirmed on-chain but DB update failed.
      // The pending row + burn_tx_hash are recoverable via the reconciliation job.
      console.error("[vouchers/issue] promote to issued failed after confirmed burn — needs reconciliation", {
        voucher_id:    pendingVoucher.voucher_id,
        burn_tx_hash:  burnTxHash,
        error:         promoteErr,
      });
      // Persist the burn_tx_hash so the reconciliation job can promote the row.
      await supabase
        .from("issued_vouchers")
        .update({ burn_tx_hash: burnTxHash, recovery_state: "burn_confirmed_promote_failed" })
        .eq("id", pendingVoucher.voucher_id)
        .eq("status", "pending"); // only update if still pending — idempotent

      // Return success with the pending row data so the user is not blocked.
      return NextResponse.json(
        { voucher: { id: pendingVoucher.voucher_id, code: pendingVoucher.code, qr_payload: pendingVoucher.qr_payload, status: "pending" } },
        { status: 201 },
      );
    }

    return NextResponse.json({ voucher }, { status: 201 });
  } catch (err: any) {
    console.error("[vouchers/issue] unexpected error", err);
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}
