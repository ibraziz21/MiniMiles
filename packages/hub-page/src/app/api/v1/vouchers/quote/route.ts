// POST /api/v1/vouchers/quote — hub-mobile-app-migration-plan.md mutation
// table. Mirrors src/app/api/shop/vouchers/quote/route.ts's business logic
// exactly (template lookup, country re-check, availability RPC, affordability
// against the Miles ledger, quote insert) — only auth/envelope differ.
import { randomUUID } from "crypto";
import { createHash } from "crypto";
import { requireActor, UnauthorizedError } from "@/lib/auth/requestActor";
import {
  assertMutationAllowed,
  ForbiddenOriginError,
  UnsupportedContentTypeError,
} from "@/lib/api/v1/mutationGuard";
import { apiSuccess, apiError } from "@/lib/api/v1/response";
import { createAdminClient } from "@/lib/supabase/admin";
import { getVoucherSpendableBalance } from "@/lib/akiba/voucherSpendableBalance";
import { isHiddenPartner } from "@/lib/akiba/hidden-partners";
import { resolveMemberCountry, resolveMerchantCountry, evaluateCountryEligibility } from "@/lib/akiba/countryEligibility";
import { getVoucherClaimFriction } from "@/lib/vouchers/claimIntent";
import { getActiveUsernameForHubUser } from "@/lib/akiba/voucherUsername";

// Bumped whenever the confirmation modal's copy changes materially — stored
// on the quote for audit purposes (see reserve_voucher_purchase's consent
// binding, migration 046_hub_miles_spend_intents.sql).
const DISCLOSURE_VERSION = "v2";

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
  const { template_id } = body ?? {};
  if (typeof template_id !== "string" || !template_id) {
    return apiError(request, "TEMPLATE_ID_REQUIRED", "template_id is required", 400);
  }

  const admin = createAdminClient();

  const { data: template } = await admin
    .from("spend_voucher_templates")
    .select("partner_id, miles_cost, active, expires_at")
    .eq("id", template_id)
    .maybeSingle();
  if (
    !template ||
    !template.active ||
    (template.expires_at && new Date(template.expires_at).getTime() <= Date.now()) ||
    isHiddenPartner(template.partner_id)
  ) {
    return apiError(request, "TEMPLATE_NOT_FOUND", "Template not found or inactive", 404);
  }

  // Country revalidation, fast-fail before doing any balance work — the real
  // enforcement point is issueVoucher() (lib/vouchers/issuance.ts), which
  // every acquisition path goes through; this is purely a UX improvement so
  // a doomed quote is never shown as if it could succeed.
  const [memberCountry, merchantCountry] = await Promise.all([
    resolveMemberCountry({ hubUserId: actor.userId, email: actor.email }).then((c) => c.code),
    resolveMerchantCountry(template.partner_id),
  ]);
  if (!evaluateCountryEligibility(memberCountry, merchantCountry).eligible) {
    return apiError(request, "COUNTRY_NOT_ELIGIBLE", "This voucher isn't available in your country", 403);
  }

  const { data: availableRows, error: availabilityErr } = await admin.rpc(
    "list_available_voucher_template_ids_hub",
    { p_hub_user_id: actor.userId },
  );
  const available = (availableRows ?? []).some(
    (row: { template_id: string } | string) =>
      typeof row === "string" ? row === template_id : row.template_id === template_id,
  );
  if (availabilityErr || !available) {
    return apiError(request, "VOUCHER_NOT_AVAILABLE", "This voucher is not currently available", 409);
  }
  const totalPoints = template.miles_cost as number;

  const [spendable, claimFriction] = await Promise.all([
    getVoucherSpendableBalance({ hubUserId: actor.userId, email: actor.email }),
    getVoucherClaimFriction(actor.userId),
  ]);
  if (!spendable.ok) {
    const [code, message] = spendable.reason === "identity_unresolved"
      ? ["IDENTITY_UNRESOLVED", "Could not resolve identity"]
      : ["BALANCE_UNAVAILABLE", "Could not read ledger balance"];
    return apiError(request, code, message, 503, { retryable: true });
  }

  // Web2-ledger-only (voucher-web2-username-identity-spec.md §4.1/§6.3) — a
  // shortfall is a hard INSUFFICIENT_MILES, never a prompt to connect a
  // wallet to cover the remainder. No split ledger/on-chain quote exists.
  if (spendable.ledgerBalance < totalPoints) {
    return apiError(request, "INSUFFICIENT_MILES", "Not enough Miles", 422);
  }
  const ledgerPoints = totalPoints;

  // Display/audit snapshot only (voucher-web2-username-identity-spec.md
  // §3.6) — never used for authorization, and never blocks a purchase when
  // the member hasn't claimed a username yet.
  const usernameAtClaim = await getActiveUsernameForHubUser({ hubUserId: actor.userId, email: actor.email });

  const purchaseKey = `hub-voucher:${randomUUID()}`;
  const requestHash = createHash("sha256")
    .update([
      actor.userId,
      template_id,
      template.partner_id,
      totalPoints,
      ledgerPoints,
      DISCLOSURE_VERSION,
    ].join(":"))
    .digest("hex");

  const { data: quote, error: insertErr } = await admin
    .from("voucher_purchase_quotes")
    .insert({
      purchase_key: purchaseKey,
      request_hash: requestHash,
      hub_user_id: actor.userId,
      template_id,
      merchant_id: template.partner_id,
      wallet_address: null,
      ledger_points: ledgerPoints,
      onchain_points: 0,
      total_points: totalPoints,
      disclosure_version: DISCLOSURE_VERSION,
      username_at_claim: usernameAtClaim,
    })
    .select("id, ledger_points, onchain_points, total_points, disclosure_version, wallet_address")
    .single();

  if (insertErr || !quote) {
    return apiError(request, "QUOTE_CREATE_FAILED", "Could not create quote", 500);
  }

  const response = apiSuccess(request, {
    quoteId: quote.id,
    ledgerPoints: quote.ledger_points,
    onchainPoints: quote.onchain_points,
    totalPoints: quote.total_points,
    disclosureVersion: quote.disclosure_version,
    walletAddress: quote.wallet_address,
    claimFriction,
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
