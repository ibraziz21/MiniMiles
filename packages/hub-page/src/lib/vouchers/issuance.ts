/**
 * Hub voucher issuance service.
 *
 * Audit corrections:
 *   #3  Burns recoverable: scoped idempotency key passed to burn API,
 *       burn_ref persisted, ambiguous failure → recovery_state='burn_ambiguous'
 *       (never void on network ambiguity)
 *   #4  Idempotency lookup scoped to same user + wallet + template + source
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { generateSecureCode } from "./codes";
import type { IssueVoucherResult, RulesSnapshot } from "./types";

const AKIBA_API = process.env.AKIBA_API_URL ?? "";
// Service key issued to the Akiba Hub by Akiba internal ops.
// This is a platform_service credential, not a merchant key.
const AKIBA_API_KEY = process.env.AKIBA_API_KEY ?? "";

type BurnResult =
  | { ok: true; burnRef: string }
  | { ok: false; definitive: true }   // burn definitively rejected (e.g. 422 insufficient balance)
  | { ok: false; definitive: false }; // outcome unknown — network/5xx/429/ambiguous 4xx

// Only HTTP 422 (Unprocessable Entity) is treated as definitively rejected.
// The burn API uses 422 for semantic rejections such as insufficient balance or
// invalid address. All other 4xx codes (400, 401, 403, 429…) are ambiguous:
// the request may have been partially processed or rate-limited, and voiding
// the voucher would silently consume miles that were never debited.
const DEFINITIVE_BURN_REJECTION = new Set([422]);

async function burnMilesWithIdempotency(
  address: string,
  amount: number,
  idempotencyKey: string,
  voucherId: string,
): Promise<BurnResult> {
  // Config guard: missing URL or key is ambiguous — we cannot call the API,
  // but we also cannot safely void (the burn was never attempted).
  if (!AKIBA_API || !AKIBA_API_KEY) {
    return { ok: false, definitive: false };
  }

  let res: Response;
  try {
    res = await fetch(`${AKIBA_API}/api/v1/miles/burn`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${AKIBA_API_KEY}`,
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        address,
        amount,
        reason: "hub_voucher_purchase",
        externalRef: voucherId,
        actorType: "platform_service",
        actorId: "akiba_hub",
      }),
    });
  } catch {
    return { ok: false, definitive: false };
  }

  if (res.ok) {
    const data = await res.json().catch(() => ({})) as Record<string, unknown>;
    return {
      ok: true,
      // Prefer the canonical ledger reference; fall back to legacy tx_hash.
      burnRef: (data.reference ?? data.tx_hash ?? idempotencyKey) as string,
    };
  }

  if (DEFINITIVE_BURN_REJECTION.has(res.status)) {
    return { ok: false, definitive: true };
  }

  return { ok: false, definitive: false };
}

export interface IssueVoucherInput {
  userId: string;
  userAddress: string;   // lowercased, ownership pre-verified
  templateId: string;
  merchantId: string;
  nonce: string;
  idempotencyKey?: string;
}

export async function issueVoucher(
  input: IssueVoucherInput
): Promise<IssueVoucherResult> {
  const admin = createAdminClient();
  const { userId, userAddress, templateId, merchantId, nonce, idempotencyKey } = input;

  // ── 1. Scoped idempotency check  (#4 fix) ────────────────────────────────
  // Verifies ownership before returning any existing row to prevent
  // a matching key from leaking a different user's voucher.
  if (idempotencyKey) {
    const { data: existing } = await admin
      .from("issued_vouchers")
      .select("id, code, status, hub_user_id, user_address, voucher_template_id, acquisition_source")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (existing) {
      const ownerOk =
        (existing.hub_user_id && existing.hub_user_id === userId) ||
        ((existing.user_address ?? "").toLowerCase() === userAddress.toLowerCase());
      const templateOk = existing.voucher_template_id === templateId;
      const sourceOk   = existing.acquisition_source === "miles_purchase";

      if (!ownerOk || !templateOk || !sourceOk) {
        return {
          ok: false,
          error: "Idempotency key conflict: key belongs to a different request",
          httpStatus: 409,
        };
      }
      return {
        ok: true,
        voucher: { id: existing.id, code: existing.code, status: existing.status },
      };
    }
  }

  // ── 2. Consume nonce (UNIQUE constraint prevents replay) ─────────────────
  const { error: nonceErr } = await admin
    .from("voucher_issue_nonces")
    .insert({ nonce, user_address: userAddress });

  if (nonceErr) {
    if (nonceErr.code === "23505") {
      return { ok: false, error: "Nonce already used — request is a replay", httpStatus: 400 };
    }
    return { ok: false, error: "Failed to consume nonce", httpStatus: 500 };
  }

  // ── 3. Generate code ──────────────────────────────────────────────────────
  const code = generateSecureCode();


  // ── 4+5. Reserve via program-aware RPC (resolves eligible program from DB) ─
  // reserve_with_program_atomic_hub:
  //   • Finds exactly one active miles_purchase program for the template.
  //   • PROGRAM_REQUIRED if none, PROGRAM_AMBIGUOUS if more than one.
  //   • Enforces program + channel cap before calling reserve_voucher_atomic_hub.
  //   • Never falls back to unlimited (Phase 1) issuance path.
  const { data: reserved, error: rpcErr } = await admin.rpc(
    "reserve_with_program_atomic_hub",
    {
      p_template_id:     templateId,
      p_user_address:    userAddress,
      p_merchant_id:     merchantId,
      p_code:            code,
      p_idempotency_key: idempotencyKey ?? null,
      p_hub_user_id:     userId,
    }
  );

  if (rpcErr) {
    const msg: string = rpcErr.message ?? "";
    if (msg.startsWith("TEMPLATE_INACTIVE")) {
      return { ok: false, error: "Template not found or inactive", httpStatus: 404 };
    }
    if (msg.startsWith("PROGRAM_REQUIRED")) {
      return { ok: false, error: "No active voucher program for this template", httpStatus: 409 };
    }
    if (msg.startsWith("PROGRAM_AMBIGUOUS")) {
      return { ok: false, error: "Multiple programs found — contact support", httpStatus: 409 };
    }
    if (msg.includes("PROGRAM_TOTAL_CAP_EXCEEDED") || msg.includes("PROGRAM_CHANNEL_CAP_EXCEEDED") || msg.startsWith("CAP_EXCEEDED")) {
      return { ok: false, error: "Supply exhausted for this voucher", httpStatus: 409 };
    }
    if (msg.includes("PROGRAM_NOT_ACTIVE") || msg.includes("PROGRAM_NOT_STARTED") || msg.includes("PROGRAM_ENDED")) {
      return { ok: false, error: "Program is not currently active", httpStatus: 409 };
    }
    if (msg.startsWith("COOLDOWN_ACTIVE")) {
      return { ok: false, error: "cooldown_active", httpStatus: 429 };
    }
    return { ok: false, error: rpcErr.message, httpStatus: 500 };
  }

  const row = (reserved as unknown as Array<{ voucher_id: string; code: string; status: string; miles_cost: number }>)[0];
  if (!row) {
    return { ok: false, error: "Reservation returned no row", httpStatus: 500 };
  }

  const voucherId = row.voucher_id;
  const milesCost = row.miles_cost;

  // ── 6. Persist burn idempotency key before calling the burn API  (#3 fix) ─
  // MUST succeed before calling the burn API.  If we cannot persist the key we
  // have no way to reconcile an ambiguous burn outcome, so we abort and void.
  const burnIdempotencyKey = `hub-burn-${userId}-${voucherId}`;

  const { error: keyErr } = await admin
    .from("issued_vouchers")
    .update({ burn_idempotency_key: burnIdempotencyKey })
    .eq("id", voucherId);

  if (keyErr) {
    await admin.from("issued_vouchers").update({ status: "void" }).eq("id", voucherId);
    return { ok: false, error: "Internal error persisting burn key", httpStatus: 500 };
  }

  // ── 7. Burn miles with scoped idempotency key  (#3 fix) ──────────────────
  const burnResult = await burnMilesWithIdempotency(userAddress, milesCost, burnIdempotencyKey, voucherId);

  if (!burnResult.ok) {
    if (burnResult.definitive) {
      // 4xx rejection — burn definitively failed; safe to void
      await admin
        .from("issued_vouchers")
        .update({ status: "void" })
        .eq("id", voucherId);

      await admin.from("voucher_events").insert({
        issued_voucher_id: voucherId,
        event_type: "voided",
        actor_id: userId,
        metadata: { reason: "burn_rejected_definitive" },
      });

      return {
        ok: false,
        error: "Miles burn rejected: insufficient balance or invalid address",
        httpStatus: 422,
      };
    } else {
      // Network error / non-definitive 4xx (429, 400…) — outcome unknown; do NOT void (#3 fix)
      // Reconciliation queries burn API with burn_idempotency_key.
      // Both the state update and audit event must persist atomically.
      // If we cannot persist recovery evidence we must NOT claim the voucher is
      // held for reconciliation — there would be no evidence for ops to act on.
      const { error: recoveryErr } = await admin.rpc("record_burn_outcome", {
        p_voucher_id:     voucherId,
        p_actor_id:       userId,
        p_recovery_state: "burn_ambiguous",
        p_event_type:     "burn_ambiguous",
        p_metadata:       { burn_idempotency_key: burnIdempotencyKey },
      });

      if (recoveryErr) {
        console.error("[issuance] Failed to record burn_ambiguous:", recoveryErr);
        return {
          ok: false,
          error: "Miles burn outcome unknown — please retry. If this persists, contact support.",
          httpStatus: 503,
        };
      }

      return {
        ok: false,
        error: "Miles burn outcome unknown — please retry. Your voucher is held for reconciliation.",
        httpStatus: 503,
      };
    }
  }

  // ── 8. Persist burn_ref after confirmed burn  (#3 fix) ───────────────────
  const { error: refErr } = await admin
    .from("issued_vouchers")
    .update({ burn_ref: burnResult.burnRef })
    .eq("id", voucherId);

  if (refErr) {
    // Burn succeeded but we couldn't save the burn_ref.
    // Atomically record recovery evidence; if that also fails we cannot safely
    // return ok:true (there would be no reconciliation record for ops to act on).
    console.error("[issuance] Failed to persist burn_ref:", refErr);
    const { error: recoveryErr } = await admin.rpc("record_burn_outcome", {
      p_voucher_id:     voucherId,
      p_actor_id:       userId,
      p_recovery_state: "burn_confirmed_promote_failed",
      p_event_type:     "burn_confirmed_promote_failed",
      p_metadata:       {},
    });
    if (recoveryErr) {
      console.error("[issuance] CRITICAL: burn confirmed but recovery state could not be recorded:", recoveryErr);
      return {
        ok: false,
        error: "Burn confirmed but recovery state could not be recorded — contact support with your voucher code.",
        httpStatus: 500,
      };
    }
    return {
      ok: true,
      voucher: { id: voucherId, code, status: "pending" },
    };
  }

  await admin.from("voucher_events").insert({
    issued_voucher_id: voucherId,
    event_type: "burn_confirmed",
    actor_id: userId,
    metadata: { burn_ref: burnResult.burnRef },
  });

  // ── 9. Promote pending → issued ───────────────────────────────────────────
  const { data: promoted, error: promoteErr } = await admin
    .from("issued_vouchers")
    .update({ status: "issued" })
    .eq("id", voucherId)
    .eq("status", "pending")
    .select("id, code, status")
    .single();

  if (promoteErr || !promoted) {
    // Burn succeeded but DB promote failed — atomically record for reconciliation.
    // If recovery evidence cannot be stored, do NOT return ok:true: there would
    // be no record for ops to find and the user would be left with no recourse.
    const { error: recoveryErr } = await admin.rpc("record_burn_outcome", {
      p_voucher_id:     voucherId,
      p_actor_id:       userId,
      p_recovery_state: "burn_confirmed_promote_failed",
      p_event_type:     "burn_confirmed_promote_failed",
      p_metadata:       { burn_ref: burnResult.burnRef },
    });

    if (recoveryErr) {
      console.error("[issuance] CRITICAL: promote failed and recovery state could not be recorded:", recoveryErr);
      return {
        ok: false,
        error: "Order processing error — your miles may have been consumed. Contact support with your voucher code.",
        httpStatus: 500,
      };
    }

    // Recovery evidence stored; a reconciliation job will promote this row.
    return {
      ok: true,
      voucher: { id: voucherId, code, status: "pending" },
    };
  }

  // Audit event
  await admin.from("voucher_events").insert({
    issued_voucher_id: voucherId,
    event_type: "issued",
    actor_id: userId,
  });

  return {
    ok: true,
    voucher: { id: promoted.id, code: promoted.code, status: promoted.status },
  };
}

// ── Ownership helper ──────────────────────────────────────────────────────────

/**
 * Returns true if the given Hub user owns the voucher.
 * Handles both new rows (hub_user_id) and legacy rows (wallet address).
 */
export async function userOwnsVoucher(
  voucherId: string,
  hubUserId: string,
  userAddresses: string[]  // all wallet addresses linked to this user
): Promise<boolean> {
  const admin = createAdminClient();
  const lc = userAddresses.map((a) => a.toLowerCase());

  const { data } = await admin
    .from("issued_vouchers")
    .select("id, hub_user_id, user_address")
    .eq("id", voucherId)
    .maybeSingle();

  if (!data) return false;

  if (data.hub_user_id) return data.hub_user_id === hubUserId;
  return lc.includes(data.user_address?.toLowerCase() ?? "");
}

// ── Rules snapshot helper ─────────────────────────────────────────────────────

/**
 * Returns the server-authoritative rules for a voucher.
 * Prefers rules_snapshot (immutable); falls back to live template join for
 * legacy rows so existing vouchers continue to work.
 */
export async function getVoucherRules(voucherId: string): Promise<RulesSnapshot | null> {
  const admin = createAdminClient();

  const { data } = await admin
    .from("issued_vouchers")
    .select(`
      rules_snapshot,
      spend_voucher_templates (
        id, merchant_id: partner_id, voucher_type, discount_percent, discount_cusd,
        applicable_category, linked_product_id, retail_value_cusd, miles_cost, title
      )
    `)
    .eq("id", voucherId)
    .maybeSingle();

  if (!data) return null;

  if (data.rules_snapshot) return data.rules_snapshot as RulesSnapshot;

  // Legacy fallback
  const tmpl = Array.isArray(data.spend_voucher_templates)
    ? data.spend_voucher_templates[0]
    : data.spend_voucher_templates;

  if (!tmpl) return null;

  return {
    template_id:        (tmpl as Record<string,unknown>).id as string,
    merchant_id:        (tmpl as Record<string,unknown>).merchant_id as string,
    voucher_type:       (tmpl as Record<string,unknown>).voucher_type as RulesSnapshot["voucher_type"],
    discount_percent:   (tmpl as Record<string,unknown>).discount_percent as number | null,
    discount_cusd:      (tmpl as Record<string,unknown>).discount_cusd as number | null,
    applicable_category:(tmpl as Record<string,unknown>).applicable_category as string | null,
    linked_product_id:  (tmpl as Record<string,unknown>).linked_product_id as string | null,
    retail_value_cusd:  (tmpl as Record<string,unknown>).retail_value_cusd as number | null,
    miles_cost:         (tmpl as Record<string,unknown>).miles_cost as number,
    title:              (tmpl as Record<string,unknown>).title as string,
    snapshotted_at:     new Date().toISOString(),
  };
}
