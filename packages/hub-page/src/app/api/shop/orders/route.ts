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
import { sendPurchaseEvent } from "@/lib/akiba/purchase-events";
import { emitQuestActions } from "@/lib/akiba/quest-events";
import { HIDDEN_PARTNER_FILTER, isHiddenPartner } from "@/lib/akiba/hidden-partners";

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

  // ── Resolve voucher by ID or legacy code  (#7 fix: reject invalid IDs) ───
  let resolvedVoucherId: string | null = null;
  let voucherRules: RulesSnapshot | null = null;
  let resolvedVoucherCode: string | null = null;

  const lookupId   = typeof voucher_id   === "string" ? voucher_id.trim()               : null;
  const lookupCode = typeof voucher_code === "string" ? voucher_code.trim().toUpperCase() : null;

  if (lookupId || lookupCode) {
    const filter = admin
      .from("issued_vouchers")
      .select(`
        id, code, status, hub_user_id, user_address, expires_at, rules_snapshot,
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

    resolvedVoucherId   = vRow.id;
    resolvedVoucherCode = vRow.code;
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
    if (new Date(stkReq.expires_at) < new Date()) {
      if (resolvedVoucherId) await releaseVoucher(resolvedVoucherId, user.id, allAddresses);
      return NextResponse.json({ error: "M-Pesa checkout session expired" }, { status: 400 });
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
    paymentMethod = `mpesa:${initiatingPhone}`;
    paidAmountUsd = actualKes / usdRate;
  }

  // ── Reject replayed payment references  (#7 fix) ─────────────────────────
  const { data: existingOrder } = await admin
    .from("merchant_transactions")
    .select("id")
    .eq("payment_ref", paymentRef)
    .maybeSingle();

  if (existingOrder) {
    if (resolvedVoucherId) {
      await releaseVoucher(resolvedVoucherId, user.id, allAddresses, "payment_ref_replayed");
    }
    return NextResponse.json({ error: "Payment reference already used" }, { status: 409 });
  }

  // ── Atomic order creation + voucher redemption  (#8 fix) ─────────────────
  // place_hub_order_and_redeem_voucher inserts the order AND redeems the voucher
  // in one database transaction. If either step fails, both roll back.
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
    }
  );

  if (placeErr) {
    // The DB transaction rolled back — both order and voucher redemption failed.
    // Release the claiming lock so the user can retry.
    if (resolvedVoucherId) {
      await releaseVoucher(resolvedVoucherId, user.id, allAddresses, "order_rpc_failed");

      // Record reconciliation incident: payment was confirmed but order creation failed.
      // This requires manual intervention.
      await Promise.resolve(
        admin.from("reconciliation_incidents").insert({
          type:       "order_rpc_failed_after_payment",
          voucher_id: resolvedVoucherId,
          data: {
            payment_ref:   paymentRef,
            payment_method: paymentMethod,
            error:          placeErr.message,
            user_id:        user.id,
          },
        })
      ).catch((e: unknown) => {
        console.error("[orders] Failed to write reconciliation incident:", e);
      });
    }

    return NextResponse.json({ error: "Order creation failed. Payment was received — support will reconcile." }, { status: 500 });
  }

  const placeRow = (placeRows as unknown as Array<{ ok: boolean; order_id: string; error_code: string }>)[0];

  if (!placeRow?.ok) {
    if (resolvedVoucherId) {
      await releaseVoucher(resolvedVoucherId, user.id, allAddresses, "order_rpc_returned_error");
    }
    return NextResponse.json({ error: placeRow?.error_code ?? "Order creation failed" }, { status: 500 });
  }

  // Ask Platform to evaluate and issue a reward for this verified purchase.
  // This is awaited so the result is included in the response, but order
  // success is not gated on it — a Platform failure still returns 201.
  const primaryWallet = allAddresses[0] ?? null;
  const purchaseAmount = isCrypto ? paidAmountUsd : Math.round(paidAmountUsd * usdRate);
  const purchaseCurrency = isCrypto ? String(currency) : "KES";
  const recipient = primaryWallet
    ? { type: "wallet" as const, value: primaryWallet }
    : user.email
      ? { type: "email" as const, value: user.email }
      : { type: "phone" as const, value: String(phone) };
  const purchaseIdempotencyKey = `hub-purchase-${placeRow.order_id}`;
  const rewardResult = await sendPurchaseEvent({
    merchantId:         product.merchant_id,
    externalPurchaseId: paymentRef,
    idempotencyKey:     purchaseIdempotencyKey,
    recipient,
    amount:             purchaseAmount,
    currency:           purchaseCurrency,
    productCategory:    product.category,
    sourceApp:          "hub",
    occurredAt:         new Date().toISOString(),
    metadata: {
      orderId:       placeRow.order_id,
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
  });

  if (!rewardResult.ok) {
    console.error(
      "[orders] Platform purchase-event failed after order",
      placeRow.order_id,
      rewardResult.error
    );
  }

  // Report quest actions for this completed order (fire-and-forget; one-time
  // quests dedupe on Platform, so emitting first_purchase every order is safe).
  await emitQuestActions([
    {
      actionName: "first_purchase",
      userId: user.id,
      walletAddress: primaryWallet,
      idempotencyKey: `quest-first_purchase-${user.id}`,
      metadata: { orderId: placeRow.order_id, email: user.email ?? null },
    },
    {
      actionName: "purchase_completed",
      userId: user.id,
      walletAddress: primaryWallet,
      idempotencyKey: `quest-purchase_completed-${placeRow.order_id}`,
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

  const rewardResponse = rewardResult.ok
    ? {
        issued: rewardResult.rewardIssued,
        miles:  rewardResult.milesAwarded,
        ...(rewardResult.reason ? { reason: rewardResult.reason } : {}),
      }
    : { issued: false, miles: 0, pending: true };

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
