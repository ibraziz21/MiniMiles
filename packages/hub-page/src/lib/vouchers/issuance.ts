/**
 * Hub voucher issuance service.
 *
 * Canonical spend-intent model (replaces the old external Platform burn-API
 * call, which is the source of the burn_ambiguous backlog): reservation,
 * ledger holds and on-chain burn-job enqueue are one atomic Postgres
 * transaction. Finalization atomically consumes those holds, posts the
 * ledger debits, and issues the voucher (reserve_voucher_purchase, see
 * supabase/migrations/046_hub_miles_spend_intents.sql). No external HTTP
 * call is made from this path anymore.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { generateSecureCode } from "./codes";
import { readChainBalanceStrict } from "@/lib/akiba/balance";
import type { IssueVoucherResult, RulesSnapshot } from "./types";

export interface IssueVoucherInput {
  userId: string;
  userAddress: string | null;   // lowercased, ownership pre-verified; null for walletless (ledger-only) purchases
  email: string | null;
  templateId: string;
  merchantId: string;
  nonce?: string;
  idempotencyKey?: string;
  consentMethod: "wallet_signature" | "hub_ui_confirmed";
  quoteId?: string | null;
  disclosureVersion: string;
  totalPoints: number;
}

export async function issueVoucher(
  input: IssueVoucherInput
): Promise<IssueVoucherResult> {
  const admin = createAdminClient();
  const {
    userId, userAddress, email, templateId, merchantId, nonce,
    idempotencyKey, consentMethod, quoteId, disclosureVersion, totalPoints,
  } = input;

  // Wallet-signature issuance still consumes the signed nonce. The Hub modal
  // path is protected by its server-generated quote key and does not invent an
  // address-shaped nonce owner for walletless users.
  if (consentMethod === "wallet_signature") {
    if (!nonce || !userAddress) {
      return { ok: false, error: "Signed wallet request is missing its nonce or wallet", httpStatus: 400 };
    }
    const { error: nonceErr } = await admin
      .from("voucher_issue_nonces")
      .insert({ nonce, user_address: userAddress });

    if (nonceErr) {
      if (nonceErr.code === "23505") {
        return { ok: false, error: "Nonce already used — request is a replay", httpStatus: 400 };
      }
      return { ok: false, error: "Failed to consume nonce", httpStatus: 500 };
    }
  }

  // ── Generate code ─────────────────────────────────────────────────────────
  const code = generateSecureCode();

  // ── 4. Resolve every wallet linked to this user (for canonical-id lookup) ─
  // A user's email + wallets can resolve to more than one canonical_id
  // (identity_links) — reserve_voucher_purchase handles that set itself;
  // this just gathers the raw identity values it needs.
  const { data: linkedWallets, error: walletsErr } = await admin
    .from("hub_user_wallets")
    .select("address")
    .eq("user_id", userId);
  if (walletsErr) {
    return { ok: false, error: "Could not resolve linked wallets", httpStatus: 503 };
  }
  const wallets = (linkedWallets ?? []).map((w: { address: string }) => w.address.toLowerCase());

  // ── 5. On-chain balance — read outside the transaction (Postgres can't ──
  // call the chain), strict variant so an RPC failure isn't conflated with
  // a real zero balance (only relevant if this purchase ends up needing an
  // on-chain portion at all; the RPC only enforces it if onchain_points > 0).
  const balanceResult = userAddress
    ? await readChainBalanceStrict(userAddress)
    : ({ ok: true, balance: 0 } as const);

  // ── 6. Single atomic reservation + ledger hold + burn-job enqueue ───────
  const idKey = idempotencyKey ?? `hub-issue-${userId}-${templateId}-${nonce ?? crypto.randomUUID()}`;
  const { data: reserved, error: rpcErr } = await admin.rpc(
    "reserve_voucher_purchase",
    {
      p_hub_user_id: userId,
      p_email: email,
      p_wallets: wallets,
      p_wallet_address: userAddress,
      p_template_id: templateId,
      p_merchant_id: merchantId,
      p_code: code,
      p_total_points: totalPoints,
      p_idempotency_key: idKey,
      p_consent_method: consentMethod,
      p_disclosure_version: disclosureVersion,
      p_quote_id: quoteId ?? null,
      p_onchain_balance_ok: balanceResult.ok,
      p_onchain_balance: balanceResult.ok ? balanceResult.balance : 0,
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
    if (msg.startsWith("IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD")) {
      return { ok: false, error: "Request conflict — please retry", httpStatus: 409 };
    }
    if (msg.startsWith("QUOTE_STALE")) {
      return { ok: false, error: "Price or balance changed — please refresh and try again", httpStatus: 409 };
    }
    if (msg.startsWith("BALANCE_UNAVAILABLE")) {
      return { ok: false, error: "Could not verify your balance — please retry", httpStatus: 503 };
    }
    if (msg.startsWith("WALLET_REQUIRED_FOR_ONCHAIN_PORTION")) {
      return { ok: false, error: "Connect a wallet to cover the remaining balance", httpStatus: 400 };
    }
    if (msg.startsWith("INSUFFICIENT_BALANCE")) {
      return { ok: false, error: "Not enough Miles", httpStatus: 422 };
    }
    if (msg.startsWith("PRICE_MISMATCH")) {
      return { ok: false, error: "Price changed — please refresh and try again", httpStatus: 409 };
    }
    return { ok: false, error: rpcErr.message, httpStatus: 500 };
  }

  const row = (reserved as unknown as Array<{
    intent_id: string; voucher_id: string; code: string;
    ledger_points: number; onchain_points: number; state: string;
    failure_code: string | null;
  }>)[0];
  if (!row) {
    return { ok: false, error: "Reservation returned no row", httpStatus: 500 };
  }

  if (row.state === "failed") {
    return {
      ok: false,
      error: row.failure_code === "RESERVATION_EXPIRED"
        ? "The purchase reservation expired — please request a new quote"
        : "This purchase failed and was not charged",
      httpStatus: 409,
    };
  }

  if (row.state === "finalized") {
    return {
      ok: true,
      voucher: { id: row.voucher_id, code: row.code, status: "issued" },
      intentState: row.state,
    };
  }

  // onchain_points > 0 — burnWorker finishes this asynchronously.
  return {
    ok: true,
    voucher: { id: row.voucher_id, code: row.code, status: "pending" },
    queued: true,
    intentState: row.state,
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
