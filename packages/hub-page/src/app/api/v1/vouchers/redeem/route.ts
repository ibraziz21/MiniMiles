// POST /api/v1/vouchers/redeem — hub-mobile-app-migration-plan.md mutation
// table. Mirrors src/app/api/shop/vouchers/redeem/route.ts's business logic
// exactly (quote ownership/match check, wallet-still-linked re-check,
// delegation to issueVoucher()) — only auth/envelope differ.
import { requireActor, UnauthorizedError } from "@/lib/auth/requestActor";
import {
  assertMutationAllowed,
  ForbiddenOriginError,
  UnsupportedContentTypeError,
} from "@/lib/api/v1/mutationGuard";
import { apiSuccess, apiError } from "@/lib/api/v1/response";
import { createAdminClient } from "@/lib/supabase/admin";
import { issueVoucher } from "@/lib/vouchers/issuance";
import {
  claimIntentIsValid,
  getVoucherClaimFriction,
  isVoucherUsePlan,
  recordVoucherClaimIntent,
} from "@/lib/vouchers/claimIntent";

export async function POST(request: Request) {
  let actor;
  try {
    actor = await requireActor(request);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return apiError(request, error.code, error.message, error.status);
    }
    throw error;
  }

  try {
    await assertMutationAllowed(request, actor);
  } catch (error) {
    if (error instanceof ForbiddenOriginError || error instanceof UnsupportedContentTypeError) {
      return apiError(request, error.code, error.message, error.status);
    }
    throw error;
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const { template_id, quote_id, confirmed, intent_confirmed, use_plan } = body ?? {};

  if (typeof template_id !== "string" || !template_id) {
    return apiError(request, "TEMPLATE_ID_REQUIRED", "template_id is required", 400);
  }

  // The burn (whether ledger, on-chain, or both) requires the user to have
  // explicitly clicked through a confirmation modal showing the real quote —
  // no wallet signature needed for this path, but a bare boolean isn't
  // enough on its own either; it must reference an actual quote (see below).
  if (confirmed !== true || typeof quote_id !== "string" || !quote_id) {
    return apiError(request, "QUOTE_CONFIRMATION_REQUIRED", "A confirmed quote is required", 400);
  }

  const claimFriction = await getVoucherClaimFriction(actor.userId);
  if (!claimIntentIsValid(intent_confirmed, use_plan, claimFriction)) {
    return apiError(
      request,
      "CLAIM_INTENT_REQUIRED",
      claimFriction.requiresUsePlan
        ? "Confirm your intent and choose how you plan to use this voucher"
        : "Confirm that you intend to use this voucher before it expires",
      400,
    );
  }

  const admin = createAdminClient();

  // The quote owns the stable purchase key and the exact wallet (or null for
  // a ledger-only walletless purchase). A retry of the same quote therefore
  // reaches the database with the same idempotency key.
  const { data: quote, error: quoteErr } = await admin
    .from("voucher_purchase_quotes")
    .select("purchase_key, wallet_address, disclosure_version, hub_user_id, template_id")
    .eq("id", quote_id)
    .maybeSingle();

  if (
    quoteErr ||
    !quote ||
    quote.hub_user_id !== actor.userId ||
    quote.template_id !== template_id
  ) {
    return apiError(request, "QUOTE_NOT_FOUND", "Quote not found or expired", 409);
  }

  const walletAddress =
    typeof quote.wallet_address === "string"
      ? quote.wallet_address.toLowerCase()
      : null;

  if (walletAddress) {
    const { data: linkedWallet } = await admin
      .from("hub_user_wallets")
      .select("address")
      .eq("user_id", actor.userId)
      .eq("address", walletAddress)
      .eq("verification_status", "verified")
      .maybeSingle();
    if (!linkedWallet) {
      return apiError(request, "WALLET_NOT_LINKED", "The wallet in this quote is no longer linked", 409);
    }
  }

  // ── Resolve merchant + price from template ──────────────────────────────
  const { data: template } = await admin
    .from("spend_voucher_templates")
    .select("partner_id, miles_cost")
    .eq("id", template_id)
    .maybeSingle();

  if (!template) {
    return apiError(request, "TEMPLATE_NOT_FOUND", "Template not found or inactive", 404);
  }

  const result = await issueVoucher({
    userId:         actor.userId,
    userAddress:    walletAddress,
    email:          actor.email,
    templateId:     template_id,
    merchantId:     (template as { partner_id: string; miles_cost: number }).partner_id,
    totalPoints:    (template as { partner_id: string; miles_cost: number }).miles_cost,
    idempotencyKey: quote.purchase_key,
    consentMethod:  "hub_ui_confirmed",
    quoteId:        quote_id,
    disclosureVersion: quote.disclosure_version,
  });

  if (!result.ok) {
    return apiError(request, "VOUCHER_ISSUE_FAILED", result.error, result.httpStatus);
  }

  await recordVoucherClaimIntent({
    hubUserId: actor.userId,
    voucherId: result.voucher.id,
    flow: "miles_purchase",
    templateId: template_id,
    usePlan: isVoucherUsePlan(use_plan) ? use_plan : null,
    friction: claimFriction,
    disclosureVersion: quote.disclosure_version,
  });

  const response = apiSuccess(
    request,
    {
      voucher: result.voucher,
      queued: result.queued ?? false,
      intentState: result.intentState,
    },
    { status: 201 },
  );
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
