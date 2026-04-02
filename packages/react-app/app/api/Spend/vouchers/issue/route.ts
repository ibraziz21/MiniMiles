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

import { NextResponse } from "next/server";
import { verifyMessage } from "viem";
import { supabase } from "@/lib/supabaseClient";
import { safeBurnMiniPoints, safeMintRefund } from "@/lib/minipoints";
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
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 10; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
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

    // ── Nonce replay check ────────────────────────────────────────────────────
    const { data: usedNonce } = await supabase
      .from("voucher_issue_nonces")
      .select("nonce")
      .eq("nonce", nonce)
      .maybeSingle();

    if (usedNonce) {
      return NextResponse.json({ error: "Nonce already used" }, { status: 400 });
    }

    // ── Signature verification ────────────────────────────────────────────────
    const message = buildSignMessage(merchant_id, template_id, user_address, timestamp, nonce);
    const valid = await verifyMessage({ address: addr, message, signature });
    if (!valid) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    // ── Store nonce (prevent replay even if rest fails) ───────────────────────
    await supabase
      .from("voucher_issue_nonces")
      .insert({ nonce, user_address: addr, used_at: new Date().toISOString() });

    // ── Fetch template ────────────────────────────────────────────────────────
    const { data: template, error: tErr } = await supabase
      .from("spend_voucher_templates")
      .select(
        `id, merchant_id, title, miles_cost, voucher_type, discount_percent,
         discount_cusd, applicable_category, cooldown_seconds, global_cap, active, expires_at`,
      )
      .eq("id", template_id)
      .eq("merchant_id", merchant_id)
      .eq("active", true)
      .single();

    if (tErr || !template) {
      return NextResponse.json({ error: "Template not found or inactive" }, { status: 404 });
    }

    if (template.expires_at && new Date(template.expires_at) < new Date()) {
      return NextResponse.json({ error: "Template has expired" }, { status: 400 });
    }

    // ── Global cap check ──────────────────────────────────────────────────────
    if (template.global_cap !== null) {
      const { count } = await supabase
        .from("issued_vouchers")
        .select("id", { count: "exact", head: true })
        .eq("voucher_template_id", template_id)
        .neq("status", "void");

      if ((count ?? 0) >= template.global_cap) {
        return NextResponse.json({ error: "Voucher supply exhausted" }, { status: 409 });
      }
    }

    // ── Per-user cooldown check ───────────────────────────────────────────────
    if (template.cooldown_seconds) {
      const cooldownCutoff = new Date(
        Date.now() - template.cooldown_seconds * 1000,
      ).toISOString();

      const { data: recentVoucher } = await supabase
        .from("issued_vouchers")
        .select("id, created_at")
        .eq("user_address", addr)
        .eq("voucher_template_id", template_id)
        .neq("status", "void")
        .gt("created_at", cooldownCutoff)
        .maybeSingle();

      if (recentVoucher) {
        return NextResponse.json(
          { error: "Cooldown active for this voucher template" },
          { status: 429 },
        );
      }
    }

    // ── Burn miles ────────────────────────────────────────────────────────────
    let burnTxHash: string;
    try {
      burnTxHash = await safeBurnMiniPoints({
        from: addr,
        points: template.miles_cost,
        reason: `voucher-issue:template_${template_id}`,
      });
    } catch (burnErr: any) {
      console.error("[vouchers/issue] burn failed", burnErr);
      return NextResponse.json(
        { error: burnErr?.shortMessage ?? "Miles burn failed" },
        { status: 422 },
      );
    }

    // ── Insert voucher (with refund fallback) ─────────────────────────────────
    const code = generateVoucherCode();
    const qr_payload = JSON.stringify({ code, merchant_id, voucher_template_id: template_id, user: addr });

    const { data: voucher, error: insertErr } = await supabase
      .from("issued_vouchers")
      .insert({
        user_address: addr,
        merchant_id,
        voucher_template_id: template_id,
        code,
        qr_payload,
        status: "issued",
        burn_tx_hash: burnTxHash,
        idempotency_key: idempotency_key ?? null,
      })
      .select("id, code, qr_payload, status")
      .single();

    if (insertErr || !voucher) {
      console.error("[vouchers/issue] DB insert failed after burn — attempting refund", insertErr);

      // Best-effort refund mint
      safeMintRefund({
        to: addr,
        points: template.miles_cost,
        reason: `voucher-refund:burn_${burnTxHash}`,
      }).catch((e) => console.error("[vouchers/issue] refund mint failed", e));

      // Audit void row (fire-and-forget — suppress errors)
      void supabase.from("issued_vouchers").insert({
        user_address: addr,
        merchant_id,
        voucher_template_id: template_id,
        code: `VOID-${Date.now()}`,
        qr_payload: "{}",
        status: "void",
        burn_tx_hash: burnTxHash,
      });

      return NextResponse.json({ error: "Voucher record failed — refund initiated" }, { status: 500 });
    }

    return NextResponse.json({ voucher }, { status: 201 });
  } catch (err: any) {
    console.error("[vouchers/issue] unexpected error", err);
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}
