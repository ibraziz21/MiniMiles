/**
 * Hub voucher redemption service.
 *
 * Audit corrections:
 *   #6  claimVoucher now calls claim_voucher_atomic DB RPC (true atomic CAS
 *       + claimed_at recorded; no more application-level SELECT + UPDATE split)
 *   #9  ClaimVoucherParams accepts userAddresses: string[] (all linked wallets)
 */
import { createAdminClient } from "@/lib/supabase/admin";
import type { RedeemVoucherResult } from "./types";

export interface ClaimVoucherParams {
  voucherId: string;
  hubUserId: string;
  /** All wallet addresses linked to this Hub user (lowercased). #9 fix */
  userAddresses: string[];
  merchantId: string;
}

export interface FinaliseRedemptionParams {
  voucherId: string;
  hubUserId: string;
  userAddress: string;
  merchantId: string;
  productId: string;
  productCategory: string;
  orderId: string;
  discountApplied: number;
}

/**
 * Step 1: Atomically transition voucher issued → claiming via DB RPC.
 *
 * The DB function:
 *   • takes a row-level FOR UPDATE lock
 *   • validates status, expiry, ownership, and merchant in one transaction
 *   • sets claimed_at (used for stale-claim recovery, not created_at)
 *   • writes an audit event
 *
 * Caller MUST call releaseVoucher on payment failure.
 */
export async function claimVoucher(
  params: ClaimVoucherParams
): Promise<{ ok: true; discountPlaceholder: number; voucherId: string } | { ok: false; error: string; httpStatus: number }> {
  const admin = createAdminClient();
  const { voucherId, hubUserId, userAddresses, merchantId } = params;

  const { data: rows, error } = await admin.rpc("claim_voucher_atomic", {
    p_voucher_id:     voucherId,
    p_hub_user_id:    hubUserId,
    p_user_addresses: userAddresses.map((a) => a.toLowerCase()),
    p_merchant_id:    merchantId,
  });

  if (error) {
    return { ok: false, error: error.message, httpStatus: 500 };
  }

  const row = (rows as unknown as Array<{ ok: boolean; error_code: string }>)[0];

  if (!row?.ok) {
    const codeMap: Record<string, { msg: string; status: number }> = {
      VOUCHER_NOT_FOUND: { msg: "Voucher not found",                        status: 404 },
      WRONG_STATUS:      { msg: "Voucher is not available for use",          status: 409 },
      EXPIRED:           { msg: "Voucher has expired",                       status: 410 },
      WRONG_OWNER:       { msg: "Voucher does not belong to your account",   status: 403 },
      WRONG_MERCHANT:    { msg: "Voucher is not valid for this merchant",     status: 400 },
    };
    const mapped = codeMap[row?.error_code ?? ""] ?? { msg: "Claim failed", status: 500 };
    return { ok: false, error: mapped.msg, httpStatus: mapped.status };
  }

  return { ok: true, discountPlaceholder: 0, voucherId };
}

/**
 * Finalise redemption after successful payment (legacy path, kept for compat).
 * Production orders now use place_hub_order_and_redeem_voucher RPC directly.
 */
export async function finaliseRedemption(
  params: FinaliseRedemptionParams
): Promise<RedeemVoucherResult> {
  const admin = createAdminClient();

  const { data: rows, error } = await admin.rpc("redeem_voucher_atomic", {
    p_voucher_id:       params.voucherId,
    p_hub_user_id:      params.hubUserId,
    p_user_address:     params.userAddress.toLowerCase(),
    p_merchant_id:      params.merchantId,
    p_product_id:       params.productId,
    p_product_category: params.productCategory,
    p_order_id:         params.orderId,
    p_discount_applied: params.discountApplied,
  });

  if (error) {
    return { ok: false, error: error.message, httpStatus: 500 };
  }

  const row = (rows as unknown as Array<{ ok: boolean; error_code: string; discount_usd: number }>)[0];
  if (!row?.ok) {
    const codeMap: Record<string, { msg: string; status: number }> = {
      VOUCHER_NOT_FOUND:    { msg: "Voucher not found",                        status: 404 },
      WRONG_STATUS:         { msg: "Voucher is not in claiming state",          status: 409 },
      EXPIRED:              { msg: "Voucher has expired",                       status: 410 },
      WRONG_OWNER:          { msg: "Voucher does not belong to your account",   status: 403 },
      WRONG_MERCHANT:       { msg: "Voucher is not valid for this merchant",     status: 400 },
      WRONG_PRODUCT:        { msg: "Voucher is not valid for this product",      status: 400 },
      WRONG_CATEGORY:       { msg: "Voucher is not valid for this category",     status: 400 },
      DISCOUNT_EXCEEDS_CAP: { msg: "Discount exceeds configured cap",            status: 400 },
    };
    const mapped = codeMap[row?.error_code ?? ""] ?? { msg: "Redemption failed", status: 500 };
    return { ok: false, error: mapped.msg, httpStatus: mapped.status };
  }

  return { ok: true, discountUsd: row.discount_usd };
}

/**
 * Release a voucher from 'claiming' back to 'issued' when payment fails.
 * Accepts all linked wallet addresses so secondary-wallet vouchers can be
 * released without knowing which address was used at issuance.
 */
export async function releaseVoucher(
  voucherId: string,
  hubUserId: string,
  userAddresses: string[],   // all linked wallet addresses (lowercased)
  reason = "payment_failed"
): Promise<void> {
  const admin = createAdminClient();
  await admin.rpc("release_claimed_voucher", {
    p_voucher_id:      voucherId,
    p_hub_user_id:     hubUserId,
    p_user_addresses:  userAddresses.map((a) => a.toLowerCase()),
    p_reason:          reason,
  });
}
