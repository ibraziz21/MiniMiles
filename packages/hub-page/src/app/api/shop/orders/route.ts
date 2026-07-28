/**
 * POST /api/shop/orders
 *
 * Audit corrections:
 *   #7  M-Pesa verified against server-recorded Daraja callback (mpesa_stk_results)
 *       Crypto Transfer.from verified against all linked wallets
 *       payment_ref replay rejected before payment processing
 *       Invalid/stale voucher IDs return explicit error (not silent full-price fallthrough)
 *   #8  Order creation + voucher redemption in one DB transaction via RPC
 *   #9  All linked wallets fetched and used consistently
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { calculateOrder } from "@/lib/pricing";
import { normalizePhone } from "@/lib/mpesa";
import { TOKENS, parseTransferLog } from "@/lib/tokens";
import type { TokenSymbol } from "@/lib/tokens";
import { claimVoucher, releaseVoucher } from "@/lib/vouchers/redemption";
import type { VoucherForPricing } from "@/lib/pricing";
import type { RulesSnapshot } from "@/lib/vouchers/types";
import { emitQuestActions } from "@/lib/akiba/quest-events";
import { HIDDEN_PARTNER_FILTER, isHiddenPartner } from "@/lib/akiba/hidden-partners";
import { buildIdentities } from "@/lib/akiba/identities";

const CELO_RPC = process.env.CELO_RPC_URL ?? "https://forno.celo.org";

async function rpc(method: string, params: unknown[]) {
  const res = await fetch(CELO_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json() as { result?: unknown };
  return json.result ?? null;
}

async function verifyOnChain(
  txHash: string,
  expectedTo: string,
  expectedAmountUsd: number,
  currency: TokenSymbol,
  buyerAddresses: string[]  // all linked wallet addresses, lowercased (#7 fix)
): Promise<{ ok: boolean; actualAmountUsd: number }> {
  const token = TOKENS[currency];
  if (!token) return { ok: false, actualAmountUsd: 0 };

  let receipt = null;
  for (let i = 0; i < 6; i++) {
    receipt = await rpc("eth_getTransactionReceipt", [txHash]);
    if (receipt) break;
    await new Promise((r) => setTimeout(r, 5000));
  }

  const r = receipt as { status?: string; logs?: Array<{ address: string; topics: string[]; data: string }> } | null;
  if (!r || r.status !== "0x1") return { ok: false, actualAmountUsd: 0 };

  for (const log of r.logs ?? []) {
    if (log.address?.toLowerCase() !== token.address.toLowerCase()) continue;
    const parsed = parseTransferLog(log);
    if (!parsed) continue;
    if (parsed.to.toLowerCase() !== expectedTo.toLowerCase()) continue;

    // Transfer.from must belong to this user (#7 fix: prevents wrong-sender attack)
    if (buyerAddresses.length > 0 && !buyerAddresses.includes(parsed.from.toLowerCase())) {
      continue;
    }

    const actualUsd = Number(parsed.value) / 10 ** token.decimals;
    if (actualUsd >= expectedAmountUsd - 0.005) return { ok: true, actualAmountUsd: actualUsd };
  }

  return { ok: false, actualAmountUsd: 0 };
}


export async function POST(request: Request) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // ── Parse body ───────────────────────────────────────────────────────────────
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const {
    product_id,
    voucher_id,           // preferred: issued_vouchers.id  (returned from /lookup)
    voucher_code,         // legacy fallback
    recipient_name,
    phone,
    city,
    location_details,
    tx_hash,
    currency,
    // M-Pesa (#7 fix): use checkout_request_id (server-recorded) not mpesa_receipt (client-forged)
    mpesa_checkout_id,
  } = body ?? {};

  const isCrypto = !!tx_hash;
  const isMpesa  = !!mpesa_checkout_id;

  // Initial validation: just enough to look up the product and payment.
  // Fulfillment fields (recipient/phone/city) are validated below, once the
  // product's authoritative product_type is known.
  if (!product_id) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (!isCrypto && !isMpesa) {
    return NextResponse.json(
      { error: "Provide either tx_hash (crypto) or mpesa_checkout_id (M-Pesa)" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // ── Product lookup ────────────────────────────────────────────────────────
  const { data: product } = await admin
    .from("merchant_products")
    .select("id, name, price_cusd, category, merchant_id, product_type")
    .eq("id", product_id)
    .eq("active", true)
    .maybeSingle();

  if (!product || isHiddenPartner(product.merchant_id)) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  // Authoritative fulfillment type — never trust product_type from the
  // request body. Missing/legacy values default to physical.
  const productType: "physical" | "digital" = product.product_type === "digital" ? "digital" : "physical";
  const requiresDelivery = productType === "physical";

  if (!recipient_name || !phone || (requiresDelivery && !city)) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const { data: settings } = await admin
    .from("partner_settings")
    .select("wallet_address")
    .eq("partner_id", product.merchant_id)
    .maybeSingle();

  if (!settings?.wallet_address) {
    return NextResponse.json({ error: "Merchant has no wallet configured" }, { status: 400 });
  }

  // ── Resolve ALL linked wallet addresses  (#9 fix) ─────────────────────────
  const { data: walletRows } = await admin
    .from("hub_user_wallets")
    .select("address")
    .eq("user_id", user.id);

  const allAddresses = (walletRows ?? []).map((r: { address: string }) => r.address.toLowerCase());
  const primaryAddress = allAddresses[0] ?? (user.email ?? user.id);
  const metadataUsername =
    typeof user.user_metadata?.username === "string"
      ? user.user_metadata.username.trim()
      : "";
  const akibaUsername =
    metadataUsername ||
    user.email?.split("@")[0] ||
    primaryAddress.slice(0, 64);

  // ── Resolve voucher by ID or legacy code  (#7 fix: reject invalid IDs) ───
  let resolvedVoucherId: string | null = null;
  let voucherRules: RulesSnapshot | null = null;
  let resolvedVoucherCode: string | null = null;
  let resolvedAcquisitionSource: string | null = null;

  const lookupId   = typeof voucher_id   === "string" ? voucher_id.trim()               : null;
  const lookupCode = typeof voucher_code === "string" ? voucher_code.trim().toUpperCase() : null;

  if (lookupId || lookupCode) {
    const filter = admin
      .from("issued_vouchers")
      .select(`
        id, code, status, hub_user_id, user_address, expires_at, rules_snapshot,
        acquisition_source,
        spend_voucher_templates (
          id, partner_id, voucher_type, discount_percent, discount_cusd,
          applicable_category, linked_product_id, retail_value_cusd, miles_cost, title
        )
      `);

    const { data: vRow } = lookupId
      ? await filter.eq("id", lookupId).maybeSingle()
      : await filter.eq("code", lookupCode!).maybeSingle();

    if (!vRow) {
      // #7 fix: explicit error instead of silent full-price fallthrough
      return NextResponse.json({ error: "Voucher not found" }, { status: 404 });
    }

    if (vRow.status !== "issued") {
      return NextResponse.json(
        { error: `Voucher is not available for use (status: ${vRow.status})` },
        { status: 409 }
      );
    }

    // Ownership check (all wallets considered)
    const ownsIt = vRow.hub_user_id
      ? vRow.hub_user_id === user.id
      : allAddresses.includes((vRow.user_address ?? "").toLowerCase());

    if (!ownsIt) {
      return NextResponse.json({ error: "Voucher does not belong to your account" }, { status: 403 });
    }

    if (vRow.expires_at && new Date(vRow.expires_at) < new Date()) {
      return NextResponse.json({ error: "Voucher has expired" }, { status: 410 });
    }

    const snap = vRow.rules_snapshot as RulesSnapshot | null;
    if (snap) {
      voucherRules = snap;
    } else {
      const tmpl = Array.isArray(vRow.spend_voucher_templates)
        ? vRow.spend_voucher_templates[0]
        : vRow.spend_voucher_templates;

      if (tmpl) {
        const t = tmpl as Record<string, unknown>;
        voucherRules = {
          template_id:         t.id as string,
          merchant_id:         t.partner_id as string,
          voucher_type:        t.voucher_type as RulesSnapshot["voucher_type"],
          discount_percent:    t.discount_percent as number | null,
          discount_cusd:       t.discount_cusd as number | null,
          applicable_category: t.applicable_category as string | null,
          linked_product_id:   t.linked_product_id as string | null,
          retail_value_cusd:   t.retail_value_cusd as number | null,
          miles_cost:          t.miles_cost as number,
          title:               t.title as string,
          snapshotted_at:      new Date().toISOString(),
        };
      }
    }

    if (voucherRules && voucherRules.merchant_id !== product.merchant_id) {
      return NextResponse.json({ error: "Voucher is not valid for this merchant" }, { status: 400 });
    }
    if (voucherRules?.linked_product_id &&
        voucherRules.linked_product_id !== String(product.id)) {
      return NextResponse.json({ error: "Voucher is not valid for this product" }, { status: 400 });
    }
    if (!voucherRules?.linked_product_id &&
        voucherRules?.applicable_category &&
        voucherRules.applicable_category !== product.category) {
      return NextResponse.json({ error: "Voucher is not valid for this category" }, { status: 400 });
    }

    resolvedVoucherId          = vRow.id;
    resolvedVoucherCode        = vRow.code;
    resolvedAcquisitionSource  = vRow.acquisition_source ?? null;
  }

  // ── Pricing ───────────────────────────────────────────────────────────────
  const pricingVoucher: VoucherForPricing | null = voucherRules
    ? {
        voucher_type:        voucherRules.voucher_type,
        discount_percent:    voucherRules.discount_percent,
        discount_cusd:       voucherRules.discount_cusd,
        applicable_category: voucherRules.applicable_category,
        linked_product_id:   voucherRules.linked_product_id,
        retail_value_cusd:   voucherRules.retail_value_cusd,
      }
    : null;

  const pricing = calculateOrder(
    product.price_cusd,
    product.category,
    product.id,
    requiresDelivery && typeof city === "string" ? city : "",
    productType,
    pricingVoucher
  );

  const usdRate = Number(process.env.USD_TO_KES ?? 130);

  // ── Claim voucher BEFORE payment (atomic DB RPC: issued → claiming) ───────
  if (resolvedVoucherId) {
    const claim = await claimVoucher({
      voucherId:     resolvedVoucherId,
      hubUserId:     user.id,
      userAddresses: allAddresses,   // all linked wallets (#9 fix)
      merchantId:    product.merchant_id,
    });

    if (!claim.ok) {
      return NextResponse.json({ error: claim.error }, { status: claim.httpStatus });
    }
  }

  // ── Payment verification  (#7 fix) ──────────────────────────────────────
  let paymentRef: string;
  let paymentMethod: string;
  let paidAmountUsd: number;

  if (isCrypto) {
    // Reject crypto checkout when user has no linked wallet.
    // Transfer.from must always match a linked wallet address — if there are
    // none we cannot verify the sender and must reject before on-chain lookup.
    if (allAddresses.length === 0) {
      if (resolvedVoucherId) await releaseVoucher(resolvedVoucherId, user.id, [], "no_linked_wallet");
      return NextResponse.json(
        { error: "No linked wallet found. Connect a wallet before paying with crypto." },
        { status: 400 }
      );
    }

    if (typeof currency !== "string") {
      if (resolvedVoucherId) await releaseVoucher(resolvedVoucherId, user.id, allAddresses);
      return NextResponse.json({ error: "Missing currency" }, { status: 400 });
    }

    const { ok, actualAmountUsd } = await verifyOnChain(
      String(tx_hash),
      settings.wallet_address,
      pricing.total,
      currency as TokenSymbol,
      allAddresses   // Transfer.from must belong to buyer (#7 fix)
    );

    if (!ok) {
      if (resolvedVoucherId) {
        await releaseVoucher(resolvedVoucherId, user.id, allAddresses, "payment_not_verified");
      }
      return NextResponse.json(
        { error: "Payment not verified. Ensure the transaction is confirmed on Celo." },
        { status: 402 }
      );
    }

    paymentRef    = String(tx_hash);
    paymentMethod = `crypto:${currency}`;
    paidAmountUsd = actualAmountUsd;

  } else {
    // M-Pesa verification: the server-recorded callback (mpesa_stk_results) is
    // the sole authoritative source of receipt, amount, and phone.  Daraja's
    // stkQuery is NOT called here — it could fabricate empty strings for missing
    // CallbackMetadata fields, and the callback table is sufficient.
    const checkoutId = String(mpesa_checkout_id).trim();

    // 1. Verify this checkout was initiated by this user (server-recorded at initiation)
    const { data: stkReq } = await admin
      .from("mpesa_stk_requests")
      .select("hub_user_id, phone, amount_kes, expires_at")
      .eq("checkout_request_id", checkoutId)
      .eq("hub_user_id", user.id)
      .maybeSingle();

    if (!stkReq) {
      if (resolvedVoucherId) await releaseVoucher(resolvedVoucherId, user.id, allAddresses);
      return NextResponse.json({ error: "M-Pesa payment not found or not initiated by this user" }, { status: 400 });
    }
    // 2. Require a successful server-recorded callback with a non-empty receipt.
    //    If the callback has not yet arrived, return a retryable 402 so the client
    //    can wait and retry (the /mpesa/status route only says "success" once the
    //    callback IS in the DB, so this gap should be very brief in practice).
    const { data: stkResult } = await admin
      .from("mpesa_stk_results")
      .select("result_code, receipt_number, amount_kes, phone")
      .eq("checkout_request_id", checkoutId)
      .maybeSingle();

    if (!stkResult) {
      if (resolvedVoucherId) await releaseVoucher(resolvedVoucherId, user.id, allAddresses, "mpesa_callback_pending");
      if (new Date(stkReq.expires_at) < new Date()) {
        return NextResponse.json({ error: "M-Pesa checkout session expired" }, { status: 400 });
      }
      return NextResponse.json(
        { error: "M-Pesa payment not yet confirmed by Safaricom — please retry in a moment", retryable: true },
        { status: 402 }
      );
    }
    if (stkResult.result_code !== "0") {
      if (resolvedVoucherId) await releaseVoucher(resolvedVoucherId, user.id, allAddresses, "mpesa_failed");
      return NextResponse.json({ error: "M-Pesa payment was not successful" }, { status: 402 });
    }
    const receiptNumber = String(stkResult.receipt_number ?? "").trim();
    if (!receiptNumber) {
      if (resolvedVoucherId) await releaseVoucher(resolvedVoucherId, user.id, allAddresses, "mpesa_callback_incomplete");
      return NextResponse.json(
        { error: "M-Pesa payment confirmation incomplete — please retry in a moment", retryable: true },
        { status: 402 }
      );
    }

    // 3. Cross-check: callback amount must match order total (±1 KES rounding)
    const expectedKes = Math.round(pricing.total * usdRate);
    const initiatedKes = Number(stkReq.amount_kes);
    const actualKes   = Number(stkResult.amount_kes);
    if (
      !Number.isFinite(actualKes) ||
      actualKes <= 0 ||
      !Number.isFinite(initiatedKes) ||
      initiatedKes <= 0
    ) {
      if (resolvedVoucherId) {
        await releaseVoucher(resolvedVoucherId, user.id, allAddresses, "mpesa_callback_incomplete");
      }
      return NextResponse.json(
        { error: "M-Pesa payment confirmation incomplete — please retry in a moment", retryable: true },
        { status: 402 }
      );
    }
    if (
      Math.abs(actualKes - expectedKes) > 1 ||
      Math.abs(actualKes - initiatedKes) > 1
    ) {
      if (resolvedVoucherId) {
        await releaseVoucher(resolvedVoucherId, user.id, allAddresses, "mpesa_amount_mismatch");
      }
      return NextResponse.json({ error: "M-Pesa payment amount does not match order total" }, { status: 402 });
    }

    // 4. Normalised phone must match the initiating request (prevents wrong-phone replay)
    const callbackPhone = normalizePhone(String(stkResult.phone ?? "").trim());
    const initiatingPhone = normalizePhone(String(stkReq.phone ?? "").trim());
    if (!callbackPhone || !initiatingPhone) {
      if (resolvedVoucherId) {
        await releaseVoucher(resolvedVoucherId, user.id, allAddresses, "mpesa_callback_incomplete");
      }
      return NextResponse.json(
        { error: "M-Pesa payment confirmation incomplete — please retry in a moment", retryable: true },
        { status: 402 }
      );
    }
    if (callbackPhone !== initiatingPhone) {
      if (resolvedVoucherId) {
        await releaseVoucher(resolvedVoucherId, user.id, allAddresses, "mpesa_phone_mismatch");
      }
      return NextResponse.json({ error: "M-Pesa payer phone does not match initiating request" }, { status: 402 });
    }

    paymentRef    = checkoutId;
    paymentMethod = "mpesa";
    paidAmountUsd = actualKes / usdRate;
  }

  // ── Reject replayed payment references  (#7 fix) ─────────────────────────
  const { data: existingOrder } = await admin
    .from("merchant_transactions")
    .select("id, status, amount_cusd")
    .eq("payment_ref", paymentRef)
    .maybeSingle();

  if (existingOrder) {
    return NextResponse.json(
      {
        order: {
          id: existingOrder.id,
          status: existingOrder.status,
          amount_cusd: existingOrder.amount_cusd,
          eta: pricing.eta,
        },
        recovered: true,
      },
      { status: 200 }
    );
  }

  // Reward accrue/release (order-lifecycle-completion-spec.md §6): the
  // reward job is created ATOMICALLY with the order (same RPC, same
  // transaction) rather than via a follow-up UPDATE — a crash between "order
  // created" and "reward payload stored" can no longer lose the reward.
  // The order id is pre-generated so the payload's idempotencyKey can use it
  // up front — getPurchaseEventForOrder reconstructs the same
  // `hub-purchase-${orderId}` key later to look the event up on My Orders.
  const preGeneratedOrderId = crypto.randomUUID();
  const primaryWallet = allAddresses[0] ?? null;
  const purchaseAmount = isCrypto ? paidAmountUsd : Math.round(paidAmountUsd * usdRate);
  const purchaseCurrency = isCrypto ? String(currency) : "KES";
  const rewardRecipient = primaryWallet
    ? { type: "wallet" as const, value: primaryWallet }
    : user.email
      ? { type: "email" as const, value: user.email }
      : { type: "phone" as const, value: String(phone) };
  const pendingRewardPayload = {
    merchantId:         product.merchant_id,
    externalPurchaseId: paymentRef,
    idempotencyKey:     `hub-purchase-${preGeneratedOrderId}`,
    recipient:           rewardRecipient,
    amount:              purchaseAmount,
    currency:            purchaseCurrency,
    productCategory:    product.category,
    sourceApp:          "hub" as const,
    occurredAt:         new Date().toISOString(),
    metadata: {
      orderId:       preGeneratedOrderId,
      hubUserId:     user.id,
      hubUserEmail:  user.email ?? null,
      walletAddress: primaryWallet,
      paymentRef,
      paymentMethod,
      amountUsd:     paidAmountUsd,
      amountKes:     Math.round(paidAmountUsd * usdRate),
      productId:     String(product.id),
      itemName:      product.name,
    },
  };

  // discovery-quests-spec.md §3.2 — built here (not inside the RPC) because
  // it needs an identity lookup (email + linked wallets) the RPC itself
  // can't do; the RPC just persists it atomically with the redemption.
  const internalEventPayload = resolvedVoucherId
    ? {
        event_type: "voucher_redeemed",
        idempotency_key: `vredeem:${resolvedVoucherId}`,
        identities: await buildIdentities({ userId: user.id, email: user.email ?? null }),
        metadata: {
          voucher_id: resolvedVoucherId,
          merchant_id: product.merchant_id,
          acquisition_source: resolvedAcquisitionSource,
        },
      }
    : null;

  // ── Atomic order creation + voucher redemption  (#8 fix) ─────────────────
  // place_hub_order_and_redeem_voucher inserts the order, the reward job,
  // and redeems the voucher in one database transaction. If any step fails,
  // all roll back.
  const { data: placeRows, error: placeErr } = await admin.rpc(
    "place_hub_order_and_redeem_voucher",
    {
      p_partner_id:       product.merchant_id,
      p_user_address:     primaryAddress,
      p_item_name:        product.name,
      p_item_category:    product.category,
      p_product_id:       String(product.id),
      p_payment_ref:      paymentRef,
      p_payment_currency: isCrypto ? String(currency) : "KES",
      p_payment_method:   paymentMethod,
      p_amount_cusd:      paidAmountUsd,
      p_amount_kes:       Math.round(paidAmountUsd * usdRate),
      p_voucher_code:     resolvedVoucherCode,
      p_voucher_id:       resolvedVoucherId,
      p_recipient_name:   String(recipient_name),
      p_phone:            String(phone),
      p_city:             requiresDelivery ? String(city) : null,
      p_location_details: requiresDelivery && typeof location_details === "string" ? location_details : null,
      p_hub_user_id:      resolvedVoucherId ? user.id : null,
      p_merchant_id:      resolvedVoucherId ? product.merchant_id : null,
      p_product_id_scope: resolvedVoucherId ? String(product.id) : null,
      p_product_category: resolvedVoucherId ? product.category : null,
      p_discount_applied: resolvedVoucherId ? pricing.discount : null,
      p_user_addresses:   resolvedVoucherId ? allAddresses : null,
      p_akiba_username:    akibaUsername,
      p_quote_kes:         Math.round(Number(product.price_cusd) * usdRate),
      p_delivery_kes:      Math.round(pricing.deliveryFee * usdRate),
      p_discount_kes:      Math.round(pricing.discount * usdRate),
      p_reward_payload:    pendingRewardPayload,
      p_order_id:          preGeneratedOrderId,
      p_internal_event_payload: internalEventPayload,
    }
  );

  if (placeErr) {
    // The DB transaction rolled back — both order and voucher redemption failed.
    // Release the claiming lock so the user can retry.
    if (resolvedVoucherId) {
      await releaseVoucher(resolvedVoucherId, user.id, allAddresses, "order_rpc_failed");
    }

    // Record every paid order failure, including purchases without a voucher.
    const { error: incidentErr } = await admin.from("reconciliation_incidents").insert({
      type:       "order_rpc_failed_after_payment",
      voucher_id: resolvedVoucherId,
      data: {
        payment_ref:   paymentRef,
        payment_method: paymentMethod,
        product_id:    String(product.id),
        recipient_name: String(recipient_name),
        phone:          String(phone),
        city:           requiresDelivery ? String(city) : null,
        location_details:
          requiresDelivery && typeof location_details === "string"
            ? location_details
            : null,
        error:         placeErr.message,
        user_id:       user.id,
        amount_cusd:   paidAmountUsd,
        amount_kes:    Math.round(paidAmountUsd * usdRate),
        payment_currency: isCrypto ? String(currency) : "KES",
        user_address:  primaryAddress,
        partner_id:    product.merchant_id,
      },
    });
    if (incidentErr && incidentErr.code !== "23505") {
      console.error("[orders] Failed to write reconciliation incident:", incidentErr.message);
    }

    console.error("[orders] Order RPC failed after verified payment:", placeErr.message);
    return NextResponse.json(
      {
        error: "Order creation failed. Payment was received — retry order creation without paying again.",
        payment_received: true,
        recoverable: true,
      },
      { status: 500 }
    );
  }

  const placeRow = (placeRows as unknown as Array<{ ok: boolean; order_id: string; error_code: string }>)[0];

  if (!placeRow?.ok) {
    if (resolvedVoucherId) {
      await releaseVoucher(resolvedVoucherId, user.id, allAddresses, "order_rpc_returned_error");
    }
    const { error: incidentErr } = await admin.from("reconciliation_incidents").insert({
      type:       "order_rpc_failed_after_payment",
      voucher_id: resolvedVoucherId,
      data: {
        payment_ref:   paymentRef,
        payment_method: paymentMethod,
        product_id:    String(product.id),
        recipient_name: String(recipient_name),
        phone:          String(phone),
        city:           requiresDelivery ? String(city) : null,
        location_details:
          requiresDelivery && typeof location_details === "string"
            ? location_details
            : null,
        error:         placeRow?.error_code ?? "Order RPC returned no result",
        user_id:       user.id,
        amount_cusd:   paidAmountUsd,
        amount_kes:    Math.round(paidAmountUsd * usdRate),
        payment_currency: isCrypto ? String(currency) : "KES",
        user_address:  primaryAddress,
        partner_id:    product.merchant_id,
      },
    });
    if (incidentErr && incidentErr.code !== "23505") {
      console.error("[orders] Failed to write reconciliation incident:", incidentErr.message);
    }
    return NextResponse.json(
      {
        error: "Order creation failed. Payment was received — retry order creation without paying again.",
        payment_received: true,
        recoverable: true,
      },
      { status: 500 }
    );
  }

  // "Payment confirmed / order placed" notification (order-lifecycle-
  // completion-spec.md §5.2). 'placed' is set by the INSERT above, not an
  // advance_order_status transition, so it's not auto-notified there.
  await admin.from("notification_outbox").insert({
    user_ref: primaryAddress,
    order_id: placeRow.order_id,
    template: "order_placed",
    status: "sent",
    sent_at: new Date().toISOString(),
    dedupe_key: `notif:${placeRow.order_id}:order_placed`,
  }).then(({ error }) => {
    if (error && error.code !== "23505") console.error("[orders] Failed to write order_placed notification:", error.message);
  });

  // Digital orders need instant fulfilment tracked, not just a payment
  // record — enqueue the ops fulfilment job and move the order to
  // provider_pending (order-lifecycle-completion-spec.md §4.2). A failure
  // here doesn't fail the response (payment already succeeded); it's logged
  // as a reconciliation incident for manual follow-up instead.
  if (!requiresDelivery) {
    const { data: enqueueRows, error: enqueueErr } = await admin.rpc("enqueue_digital_fulfillment", {
      p_order_id: placeRow.order_id,
      p_payload: {
        product_id: String(product.id),
        item_name: product.name,
        recipient_name: String(recipient_name),
        phone: String(phone),
      },
    });
    const enqueueResult = (enqueueRows as Array<{ ok: boolean; error_code: string }> | null)?.[0];

    if (enqueueErr || !enqueueResult?.ok) {
      console.error("[orders] enqueue_digital_fulfillment failed:", enqueueErr, enqueueResult);
      await admin.from("reconciliation_incidents").insert({
        type: "fulfillment_job_enqueue_failed",
        voucher_id: resolvedVoucherId,
        data: {
          order_id: placeRow.order_id,
          product_id: String(product.id),
          error: enqueueResult?.error_code ?? enqueueErr?.message ?? "unknown",
        },
      }).then(({ error }) => {
        if (error) console.error("[orders] Failed to write reconciliation incident:", error.message);
      });
    }
  }

  // Report quest actions for this order (fire-and-forget; one-time quests
  // dedupe on Platform, so emitting first_purchase every order is safe).
  // purchase_completed is NOT emitted here — an order is merely 'placed' at
  // this point, not completed, and could still be cancelled/refunded. It
  // fires from lib/akiba/reward-release.ts instead, gated on the reward job
  // (created atomically with this same order) actually releasing, which
  // only happens once advance_order_status reaches 'completed'.
  await emitQuestActions([
    {
      actionName: "first_purchase",
      userId: user.id,
      walletAddress: primaryWallet,
      idempotencyKey: `quest-first_purchase-${user.id}`,
      metadata: { orderId: placeRow.order_id, email: user.email ?? null },
    },
    ...(resolvedVoucherId
      ? [
          {
            actionName: "first_voucher_redeemed" as const,
            userId: user.id,
            walletAddress: primaryWallet,
            idempotencyKey: `quest-first_voucher_redeemed-${user.id}`,
            metadata: {
              orderId: placeRow.order_id,
              voucherId: resolvedVoucherId,
              email: user.email ?? null,
            },
          },
        ]
      : []),
  ]);

  const rewardResponse = { issued: false, miles: 0, pending: true };

  return NextResponse.json(
    {
      order: {
        id:          placeRow.order_id,
        status:      "placed",
        amount_cusd: paidAmountUsd,
        eta:         pricing.eta,
      },
      reward: rewardResponse,
    },
    { status: 201 }
  );
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  // Fetch ALL linked wallet addresses (#9 fix: not just the first one)
  const { data: walletRows } = await admin
    .from("hub_user_wallets")
    .select("address")
    .eq("user_id", user.id);

  if (!walletRows || walletRows.length === 0) return NextResponse.json({ orders: [] });

  const addresses = walletRows.map((r: { address: string }) => r.address);

  const { data: orders } = await admin
    .from("merchant_transactions")
    .select(
      "id, status, item_name, item_category, amount_cusd, payment_currency, " +
      "payment_method, city, recipient_name, created_at, delivered_at, voucher_code, " +
      "partners ( name, image_url )"
    )
    .in("user_address", addresses)
    .order("created_at", { ascending: false })
    .limit(50);

  return NextResponse.json({ orders: orders ?? [] });
}
