// Shared contract for the Akiba-funded voucher fund/allocation admin surface.
//
// Akiba Platform owns voucher_funding_programs / voucher_funding_allocations /
// voucher_eligibility_rule_sets and their atomic RPCs (Akiba-Platform migrations
// 115-117). MiniMiles never writes those rows directly — every mutation goes
// through one of the RPCs below, via the shared service-role Supabase client.
// See packages/admin-dashboard/docs/akiba-funded-voucher-admin-spec.md.

import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";
import { supabase } from "./supabase";

// ── Akiba-owned RPCs ──────────────────────────────────────────────────────────
//
// Signatures (Akiba-Platform migrations 116 + 117). All are SECURITY DEFINER,
// service_role only, and raise a Postgres exception (ERRCODE P0001) with a
// stable code as the message on failure — see parseRpcErrorCode below.

export const VOUCHER_FUND_RPCS = {
  createProgram: "create_voucher_funding_program_atomic",
  updateProgramDraft: "update_voucher_funding_program_draft_atomic",
  transitionProgram: "transition_voucher_funding_program_atomic",
  createEligibilityRuleSet: "create_voucher_eligibility_rule_set_atomic",
  createAllocation: "create_voucher_funding_allocation_atomic",
  updateAllocationDraft: "update_voucher_funding_allocation_draft_atomic",
  transitionAllocation: "transition_voucher_funding_allocation_atomic",
} as const;

export const VOUCHER_FUND_VIEWS = {
  allocationBudget: "v_voucher_funding_allocation_budget",
  allocationAvailability: "v_voucher_funding_allocation_availability",
  programBudget: "v_voucher_funding_program_budget",
} as const;

/** Actor id sent to Akiba RPCs in local open-access mode (p_actor_id/p_created_by are UUID columns). */
export const OPEN_ACCESS_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

export type ProgramAction = "submit" | "approve" | "reject" | "publish" | "pause" | "resume" | "end";
export type AllocationAction = "submit" | "approve" | "reject" | "publish" | "pause" | "resume" | "end";

export async function transitionProgram(
  programId: string,
  action: ProgramAction,
  actorId: string,
  reason: string | null,
  expectedRevision: number | null,
) {
  return supabase.rpc(VOUCHER_FUND_RPCS.transitionProgram, {
    p_program_id: programId,
    p_action: action,
    p_actor_id: actorId,
    p_reason: reason,
    p_expected_revision: expectedRevision,
  });
}

export async function transitionAllocation(
  allocationId: string,
  action: AllocationAction,
  actorId: string,
  reason: string | null,
) {
  return supabase.rpc(VOUCHER_FUND_RPCS.transitionAllocation, {
    p_allocation_id: allocationId,
    p_action: action,
    p_actor_id: actorId,
    p_reason: reason,
  });
}

// ── Money at the API boundary ────────────────────────────────────────────────
//
// KES is authoritative and stored in minor units (cents) on the Platform side
// (companion spec §10 "KES is authoritative"). The admin UI works in whole/
// fractional KES; convert at the boundary and never do float math on minor units.

export function kesToMinor(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

export function minorToKes(minor: number | string | null | undefined): number {
  return Math.round(Number(minor ?? 0)) / 100;
}

// ── Eligibility rule catalogue (companion spec §8.3) ─────────────────────────

export const ELIGIBILITY_RULE_TYPES = [
  "country_in",
  "pass_activated",
  "profile_country_set",
  "minimum_account_age_days",
  "verified_activity_completed",
  "first_funded_voucher",
  "no_prior_merchant_redemption",
  "fund_claim_cooldown",
  "not_blocked",
] as const;
export type EligibilityRuleType = (typeof ELIGIBILITY_RULE_TYPES)[number];

export const ELIGIBILITY_RULE_LABELS: Record<EligibilityRuleType, string> = {
  country_in: "Member country is in an allowed list",
  pass_activated: "Akiba Pass is activated",
  profile_country_set: "Profile country is set",
  minimum_account_age_days: "Minimum account age",
  verified_activity_completed: "Completed a qualifying verified activity",
  first_funded_voucher: "First Akiba-funded voucher, ever (any fund)",
  no_prior_merchant_redemption: "No previous redemption at this merchant",
  fund_claim_cooldown: "Claim cooldown since their last claim (any fund)",
  not_blocked: "Member is not blocked or under manual review",
};

// Runtime caveats worth surfacing next to the rule picker — read directly
// from the evaluator (Akiba-Platform packages/api/lib/voucherFunding/eligibility.ts),
// not aspirational. Only the rules with a real gap between what they sound
// like and what they currently do get an entry here.
export const ELIGIBILITY_RULE_WARNINGS: Partial<Record<EligibilityRuleType, string>> = {
  not_blocked: "Not enforced yet — the platform has no blocklist table. Selecting this does nothing today.",
  first_funded_voucher: "Scoped to the member, not this fund — blocks anyone who has ever claimed from any Akiba fund.",
  fund_claim_cooldown: "Scoped to the member, not this fund — the cooldown counts a claim from any Akiba fund, not just this one.",
  minimum_account_age_days: "Requires a Hub account — always fails for a wallet-only identity.",
};

// Verification handler keys — companion spec §8.3 / admin spec §7.4.
export const VERIFIED_ACTIVITY_TEMPLATE_KEYS = [
  "pass_activated",
  "profile_country_set",
  "sponsored_game_played",
  "hub_purchase_completed",
  "voucher_redeemed",
  "akiba_miles_spend",
  "daily_checkin_claimed",
  "streak_completion",
] as const;

export function isValidEligibilityRule(rule: unknown): rule is { type: EligibilityRuleType; [k: string]: unknown } {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) return false;
  const type = (rule as Record<string, unknown>).type;
  if (typeof type !== "string" || !(ELIGIBILITY_RULE_TYPES as readonly string[]).includes(type)) return false;
  if (type === "verified_activity_completed") {
    const key = (rule as Record<string, unknown>).templateKey;
    if (typeof key !== "string" || !key) return false;
  }
  return true;
}

export const DISTRIBUTION_MODES = ["self_claim", "internal_grant", "auto_award"] as const;
export type DistributionMode = (typeof DISTRIBUTION_MODES)[number];

export const DISTRIBUTION_MODE_LABELS: Record<DistributionMode, string> = {
  self_claim: "Eligible claim (member discovers and claims)",
  internal_grant: "Direct grant (admin selects a member)",
  auto_award: "Automatic award (post-issuance, not yet enabled)",
};

// ── RPC error codes → admin-safe messages (spec §16 + Akiba-Platform 116/117) ─

const NOT_FOUND_CODES = new Set([
  "PROGRAM_NOT_FOUND",
  "ALLOCATION_NOT_FOUND",
  "ELIGIBILITY_RULE_SET_NOT_FOUND",
]);

const BAD_INPUT_CODES = new Set([
  "PROGRAM_NAME_REQUIRED",
  "INVALID_AUTHORIZED_BUDGET",
  "INVALID_PROGRAM_WINDOW",
  "INVALID_COUNTRY_CODE",
  "PROGRAM_APPROVAL_REASON_REQUIRED",
  "RESCHEDULE_REASON_REQUIRED",
  "INVALID_RULE_SET_MODE",
  "RULE_SET_REQUIRES_AT_LEAST_ONE_RULE",
  "UNSUPPORTED_ELIGIBILITY_RULE_TYPE",
  "VERIFIED_ACTIVITY_RULE_REQUIRES_TEMPLATE_KEY",
  "INVALID_VOUCHER_TITLE",
  "INVALID_DISCOUNT_KES",
  "INVALID_MINIMUM_SPEND_KES",
  "INVALID_QUANTITY_CAP",
  "INVALID_CLAIM_WINDOW",
  "INVALID_VOUCHER_VALIDITY",
]);

export const VOUCHER_FUND_ERROR_MESSAGES: Record<string, string> = {
  PROGRAM_NOT_FOUND: "Voucher fund not found.",
  PROGRAM_NAME_REQUIRED: "Fund name is required.",
  INVALID_AUTHORIZED_BUDGET: "Authorized budget must be a positive amount.",
  INVALID_PROGRAM_WINDOW: "Fund start must be before its end date.",
  INVALID_COUNTRY_CODE: "Country must be a valid ISO 3166-1 alpha-2 code.",
  PROGRAM_NOT_EDITABLE: "Only a draft fund can be edited.",
  PROGRAM_VERSION_CONFLICT: "This fund changed since you loaded it. Reload and retry.",
  BUDGET_BELOW_COMMITTED_EXPOSURE: "Budget cannot be reduced below the fund's already-committed exposure.",
  PROGRAM_INVALID_STATE_TRANSITION: "That action is not valid for the fund's current state.",
  PROGRAM_APPROVAL_REVISION_MISMATCH: "The fund's approval was revised since you loaded it. Reload and retry.",
  PROGRAM_APPROVAL_REASON_REQUIRED: "A reason of at least 4 characters is required to approve.",
  PROGRAM_NOT_RESCHEDULABLE: "Only an approved, scheduled, active, or paused fund can be rescheduled.",
  RESCHEDULE_REASON_REQUIRED: "A reason of at least 4 characters is required to reschedule.",
  PROGRAM_NOT_READY_FOR_ALLOCATION: "Finance approval is required before allocations can be added.",
  PROGRAM_NOT_LIVE: "The parent fund must be approved and live before an allocation can publish.",
  PROGRAM_BUDGET_EXCEEDED: "No approved fund budget remains for this allocation.",
  ALLOCATION_NOT_FOUND: "Merchant allocation not found.",
  ALLOCATION_NOT_EDITABLE: "Only a draft allocation can be edited — create a new allocation version instead.",
  ALLOCATION_NOT_DRAFT: "Only a draft allocation can be deleted — use End to permanently stop a submitted or published one.",
  ALLOCATION_VERSION_CONFLICT: "This allocation changed since you loaded it. Reload and retry.",
  ALLOCATION_INVALID_STATE_TRANSITION: "That action is not valid for the allocation's current state.",
  ALLOCATION_TEMPLATE_MERCHANT_MISMATCH: "The voucher template's merchant does not match this allocation.",
  MERCHANT_NOT_ELIGIBLE: "Merchant is inactive, suspended, or not ready for redemption.",
  MERCHANT_COUNTRY_MISMATCH: "Merchant country does not match the fund's country.",
  INVALID_VOUCHER_TITLE: "A customer-facing voucher title is required.",
  INVALID_DISCOUNT_KES: "Discount value must be a positive KES amount.",
  INVALID_MINIMUM_SPEND_KES: "Minimum purchase must be at least the discount value.",
  INVALID_QUANTITY_CAP: "Quantity must be a positive integer.",
  INVALID_CLAIM_WINDOW: "Claim start must be before claim end.",
  INVALID_VOUCHER_VALIDITY: "Voucher validity after claim must be a positive duration.",
  AUTHORIZED_BUDGET_BELOW_COMMITMENT_FLOOR: "Authorized budget must cover quantity × discount value.",
  ELIGIBILITY_RULE_SET_NOT_FOUND: "Selected eligibility rule set was not found for this fund.",
  ELIGIBILITY_RULE_INVALID: "One or more eligibility rules are unsupported.",
  UNSUPPORTED_ELIGIBILITY_RULE_TYPE: "One or more eligibility rules are unsupported.",
  RULE_SET_REQUIRES_AT_LEAST_ONE_RULE: "Select at least one eligibility rule.",
  INVALID_RULE_SET_MODE: "Eligibility mode must be “all” or “any”.",
  VERIFIED_ACTIVITY_RULE_REQUIRES_TEMPLATE_KEY: "Select a qualifying activity for the verified-activity rule.",
};

/** Extracts the stable leading error code from a Postgres RAISE EXCEPTION message. */
export function parseRpcErrorCode(error: Pick<PostgrestError, "message"> | null | undefined): string | null {
  if (!error?.message) return null;
  const code = error.message.split(":")[0]?.trim();
  return code || null;
}

export function messageForRpcError(error: Pick<PostgrestError, "message"> | null | undefined): string {
  const code = parseRpcErrorCode(error);
  if (code && VOUCHER_FUND_ERROR_MESSAGES[code]) return VOUCHER_FUND_ERROR_MESSAGES[code];
  return error?.message ?? "Operation failed.";
}

export function statusForRpcError(error: Pick<PostgrestError, "message"> | null | undefined): number {
  const code = parseRpcErrorCode(error);
  if (!code) return 409;
  if (NOT_FOUND_CODES.has(code)) return 404;
  if (BAD_INPUT_CODES.has(code)) return 400;
  return 409;
}

/** Standard error response for a failed RPC call, with the Postgres code for debugging. */
export function rpcErrorResponse(error: PostgrestError) {
  return NextResponse.json(
    { error: messageForRpcError(error), code: parseRpcErrorCode(error) },
    { status: statusForRpcError(error) },
  );
}

// ── Text/number hygiene ───────────────────────────────────────────────────────

export function textOrNull(value: unknown, maxLength = 2000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

export function positiveIntOrNull(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return null;
  return n;
}
