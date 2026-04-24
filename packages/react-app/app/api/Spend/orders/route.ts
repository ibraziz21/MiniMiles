// POST /api/Spend/orders
// Verifies an on-chain stablecoin payment then records the order.
//
// Body:
//   user_address           string
//   product_id             number
//   voucher_code           string | null
//   recipient_name         string
//   phone                  string
//   city                   string
//   location_details       string
//   delivery_fee_tx_hash   string  (0x...)
//   currency               "cUSD" | "USDT" | "USDC"

import { NextResponse } from "next/server";
import { parseUnits, decodeEventLog, type Abi } from "viem";
import { celoClient } from "@/lib/celoClient";
import { supabase } from "@/lib/supabaseClient";
import { calculateOrderTotal } from "@/lib/spendOrderPricing";
import { isBlacklisted } from "@/lib/blacklist";
import { requireSession } from "@/lib/auth";

const KES_RATE = 130;

function normalizeCity(value: string): string {
  return value.trim().toLowerCase();
}

function toVoucherEnumValue(template: {
  voucher_type?: string | null;
  applicable_category?: string | null;
} | null): string | null {
  if (!template) return null;

  const category = template.applicable_category?.trim();

  if (template.voucher_type === "free" && category) {
    return `${category}_FREE`.replace(/\s+/g, "_").toUpperCase();
  }

  return null;
}

// ── Supported stablecoins on Celo ─────────────────────────────────────────────
const STABLE_TOKENS: Record<string, { address: `0x${string}`; decimals: number }> = {
  cUSD: {
    address: (process.env.CUSD_ADDRESS ?? "0x765de816845861e75a25fca122bb6898b8b1282a") as `0x${string}`,
    decimals: 18,
  },
  USDT: {
    address: (process.env.USDT_ADDRESS ?? "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e") as `0x${string}`,
    decimals: 6,
  },
  USDC: {
    address: (process.env.USDC_ADDRESS ?? "0xcebA9300f2b948710d2653dD7B07f33A8B32118C") as `0x${string}`,
    decimals: 6,
  },
};

const ERC20_TRANSFER_ABI: Abi = [
  {
    name: "Transfer",
    type: "event",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
];

/** Verify that a tx hash contains an ERC-20 Transfer matching expected params. */
async function verifyPayment(params: {
  txHash: `0x${string}`;
  tokenAddress: `0x${string}`;
  decimals: number;
  from: `0x${string}`;
  to: `0x${string}`;
  expectedAmountUsd: number;
}): Promise<void> {
  const { txHash, tokenAddress, decimals, from, to, expectedAmountUsd } = params;

  const receipt = await celoClient.getTransactionReceipt({ hash: txHash });

  if (receipt.status !== "success") {
    throw new Error("Transaction failed on-chain");
  }

  const expectedAmount = parseUnits(expectedAmountUsd.toFixed(6), decimals);
  // Allow ±100 units tolerance (covers parseUnits rounding at different decimal precisions)
  const tolerance = 100n;

  const relevantLogs = receipt.logs.filter(
    (log) => log.address.toLowerCase() === tokenAddress.toLowerCase(),
  );

  if (relevantLogs.length === 0) {
    throw new Error(`No transfer found from token ${tokenAddress}`);
  }

  let found = false;
  for (const log of relevantLogs) {
    try {
      const decoded = decodeEventLog({
        abi: ERC20_TRANSFER_ABI,
        data: log.data,
        topics: log.topics,
      }) as any;

      if (
        decoded.eventName === "Transfer" &&
        decoded.args.from.toLowerCase() === from.toLowerCase() &&
        decoded.args.to.toLowerCase() === to.toLowerCase()
      ) {
        const diff =
          decoded.args.value > expectedAmount
            ? decoded.args.value - expectedAmount
            : expectedAmount - decoded.args.value;

        if (diff <= tolerance) {
          found = true;
          break;
        }
      }
    } catch {
      // log not a Transfer event — skip
    }
  }

  if (!found) {
    throw new Error("Payment amount or recipient does not match expected values");
  }
}

export async function POST(req: Request) {
  try {
    // ── Authentication ────────────────────────────────────────────────────────
    const session = await requireSession();
    if (!session) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    // user_address is taken from the session, not the request body, so the
    // caller cannot forge orders on behalf of another address.
    const addr = session.walletAddress.toLowerCase() as `0x${string}`;

    const body = await req.json();
    const {
      product_id,
      voucher_code,
      recipient_name,
      phone,
      city,
      location_details,
      delivery_fee_tx_hash,
      currency,
    } = body;

    // ── Validation ────────────────────────────────────────────────────────────
    if (!product_id || !recipient_name || !phone || !city || !delivery_fee_tx_hash || !currency) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const token = STABLE_TOKENS[currency as string];
    if (!token) {
      return NextResponse.json({ error: "Unsupported currency" }, { status: 400 });
    }

    const deliveryFeeAddress = process.env.DELIVERY_FEE_ADDRESS as `0x${string}` | undefined;
    if (!deliveryFeeAddress) {
      console.error("[orders] DELIVERY_FEE_ADDRESS env not set");
      return NextResponse.json({ error: "Payment address not configured" }, { status: 500 });
    }

    if (await isBlacklisted(addr, "Spend/orders")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // ── Replay protection — tx hash uniqueness ────────────────────────────────
    const { data: existingOrder } = await supabase
      .from("merchant_transactions")
      .select("id")
      .eq("payment_ref", delivery_fee_tx_hash)
      .maybeSingle();

    if (existingOrder) {
      return NextResponse.json({ error: "Transaction hash already used" }, { status: 409 });
    }

    // ── Fetch product ─────────────────────────────────────────────────────────
    const { data: product, error: pErr } = await supabase
      .from("merchant_products")
      .select("id, name, price_cusd, category, merchant_id, active")
      .eq("id", product_id)
      .single();

    if (pErr || !product || !product.active) {
      return NextResponse.json({ error: "Product not found or inactive" }, { status: 404 });
    }

    const { data: partnerSettings, error: settingsErr } = await supabase
      .from("partner_settings")
      .select("store_active,delivery_cities")
      .eq("partner_id", product.merchant_id)
      .maybeSingle();

    if (settingsErr) {
      console.error("[orders] failed to fetch partner settings", settingsErr);
      return NextResponse.json({ error: "Merchant settings unavailable" }, { status: 500 });
    }

    if (partnerSettings?.store_active === false) {
      return NextResponse.json({ error: "Merchant is not accepting orders right now" }, { status: 409 });
    }

    if (partnerSettings?.delivery_cities?.length) {
      const allowedCities = partnerSettings.delivery_cities
        .map((allowedCity: string) => normalizeCity(allowedCity))
        .filter(Boolean);

      if (!allowedCities.includes(normalizeCity(city))) {
        return NextResponse.json(
          { error: "Delivery is not available in the selected city for this merchant" },
          { status: 400 },
        );
      }
    }

    // ── Atomically claim voucher (if provided) ────────────────────────────────
    // UPDATE ... WHERE status = 'issued' RETURNING * is a single atomic operation.
    // If two requests race, only the one whose UPDATE touches a row proceeds;
    // the other gets 0 rows back and is rejected here — before pricing is
    // calculated and before any order is inserted.
    // The voucher is set to 'claiming' for the lifetime of this request.
    // On any subsequent failure it is reset back to 'issued'.
    let voucher: any = null;
    let voucherRules: any = null;
    let merchantVoucherValue: string | null = null;
    if (voucher_code) {
      const { data: claimed, error: claimErr } = await supabase
        .from("issued_vouchers")
        .update({ status: "claiming" })
        .eq("code", voucher_code)
        .eq("user_address", addr)
        .eq("status", "issued") // atomic guard — only one concurrent request wins
        .select("id, code, status, voucher_template_id, user_address")
        .maybeSingle();

      if (claimErr) {
        console.error("[orders] voucher claim error", claimErr);
        return NextResponse.json({ error: "Failed to reserve voucher" }, { status: 500 });
      }
      if (!claimed) {
        // 0 rows updated — either not found, wrong owner, or already claimed/redeemed
        const { data: existing } = await supabase
          .from("issued_vouchers")
          .select("status")
          .eq("code", voucher_code)
          .eq("user_address", addr)
          .maybeSingle();
        const reason = !existing ? "not found" : existing.status;
        return NextResponse.json({ error: `Voucher ${reason}` }, { status: existing ? 409 : 404 });
      }
      voucher = claimed;

      // Fetch template rules
      if (claimed.voucher_template_id) {
        const { data: tpl } = await supabase
          .from("spend_voucher_templates")
          .select("title, voucher_type, discount_percent, discount_cusd, applicable_category")
          .eq("id", claimed.voucher_template_id)
          .single();

        if (tpl) {
          voucherRules = {
            title: tpl.title ?? null,
            voucher_type: tpl.voucher_type,
            discount_percent: tpl.discount_percent ?? null,
            discount_cusd: tpl.discount_cusd != null ? Number(tpl.discount_cusd) : null,
            applicable_category: tpl.applicable_category ?? null,
          };
          merchantVoucherValue = toVoucherEnumValue(tpl);
        }
      }
    }

    // ── Calculate expected total ──────────────────────────────────────────────
    const pricing = calculateOrderTotal({
      product_price_cusd: Number(product.price_cusd),
      product_category: product.category,
      city,
      voucher: voucherRules,
    });

    await supabase
      .from("users")
      .upsert({ user_address: addr }, { onConflict: "user_address", ignoreDuplicates: true });

    const { data: userRow, error: userErr } = await supabase
      .from("users")
      .select("username")
      .eq("user_address", addr)
      .maybeSingle();

    if (userErr) {
      console.error("[orders] failed to fetch user record", userErr);
    }

    // ── Verify on-chain payment ───────────────────────────────────────────────
    try {
      await verifyPayment({
        txHash: delivery_fee_tx_hash as `0x${string}`,
        tokenAddress: token.address,
        decimals: token.decimals,
        from: addr,
        to: deliveryFeeAddress,
        expectedAmountUsd: pricing.total_cusd,
      });
    } catch (verifyErr: any) {
      console.error("[orders] payment verification failed", verifyErr.message);
      // Release the voucher claim so the user can retry with a valid payment
      if (voucher) {
        await supabase
          .from("issued_vouchers")
          .update({ status: "issued" })
          .eq("id", voucher.id)
          .eq("status", "claiming");
      }
      return NextResponse.json({ error: verifyErr.message }, { status: 422 });
    }

    // ── Insert order ──────────────────────────────────────────────────────────
    // Order is inserted BEFORE marking the voucher redeemed.
    // If the insert fails the voucher stays "issued" (safe to retry).
    // If the voucher update fails after a successful insert we have an order with
    // an unredeemed voucher — the DB unique constraint on payment_ref prevents
    // a duplicate order being created on retry, and the voucher status can be
    // corrected by a background job or support action.
    const productPriceKes = Math.round(Number(product.price_cusd) * KES_RATE);
    const discountedProductKes = Math.round(pricing.discounted_product_cusd * KES_RATE);
    const deliveryFeeKes = Math.round(pricing.delivery_fee_cusd * KES_RATE);
    const discountKes = pricing.voucher_applied
      ? Math.max(0, productPriceKes - discountedProductKes)
      : null;

    const { data: order, error: oErr } = await supabase
      .from("merchant_transactions")
      .insert({
        partner_id: product.merchant_id,
        akiba_username: userRow?.username ?? addr.slice(2, 10),
        user_address: addr,
        product_id: String(product.id),
        item_name: product.name,
        item_category: product.category ?? "general",
        // Legacy column is a Postgres enum in production. Keep rich product
        // categories in item_category; use the stable legacy bucket here.
        category: "general",
        action: "redeem",
        quote_kes: productPriceKes,
        labor_kes: deliveryFeeKes,
        amount_kes: pricing.total_kes,
        amount_cusd: pricing.total_cusd,
        voucher: merchantVoucherValue,
        voucher_id: voucher?.id ?? null,
        voucher_code: voucher?.code ?? null,
        miles_cost: "0",
        discount_kes: discountKes,
        paid_kes: pricing.total_kes,
        payment_method: "onchain_transfer",
        payment_currency: currency,
        payment_ref: delivery_fee_tx_hash,
        // Delivery details
        recipient_name,
        phone,
        city,
        location_details: location_details ?? null,
        // Order starts at "placed" — fulfillment lifecycle proceeds from here
        status: "placed",
        error: null,
      })
      .select("id, status, paid_kes")
      .single();

    if (oErr || !order) {
      console.error("[orders] insert failed", oErr);
      // Release the voucher claim so the user can retry
      if (voucher) {
        await supabase
          .from("issued_vouchers")
          .update({ status: "issued" })
          .eq("id", voucher.id)
          .eq("status", "claiming");
      }
      return NextResponse.json({ error: "Failed to create order" }, { status: 500 });
    }

    // ── Finalize voucher as redeemed ──────────────────────────────────────────
    if (voucher) {
      const { error: vErr } = await supabase
        .from("issued_vouchers")
        .update({ status: "redeemed" })
        .eq("id", voucher.id)
        .eq("status", "claiming");

      if (vErr) {
        console.error("[orders] voucher finalize failed after order insert — needs reconciliation", {
          order_id: order.id,
          voucher_id: voucher.id,
          error: vErr,
        });
      }
    }

    // ── Notify merchant dashboard of new order (fire-and-forget) ─────────────
    const merchantDashboardUrl = process.env.MERCHANT_DASHBOARD_URL;
    const webhookSecret = process.env.INTERNAL_WEBHOOK_SECRET;
    if (merchantDashboardUrl && webhookSecret) {
      fetch(`${merchantDashboardUrl}/api/internal/new-order`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-webhook-secret": webhookSecret,
        },
        body: JSON.stringify({ orderId: order.id }),
      }).catch((err) => console.error("[orders] merchant notify failed:", err));
    }

    return NextResponse.json(
      {
        order: {
          id: order.id,
          status: order.status,
          amount_paid_cusd: pricing.total_cusd,
          delivery_eta: pricing.delivery_eta,
          miles_earned: 0,
        },
      },
      { status: 201 },
    );
  } catch (err: any) {
    console.error("[orders] unexpected error", err);
    return NextResponse.json({ error: err?.message ?? "Internal error" }, { status: 500 });
  }
}
