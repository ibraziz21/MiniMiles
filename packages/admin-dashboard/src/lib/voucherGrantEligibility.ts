import { supabase } from "@/lib/supabase";
import {
  ELIGIBILITY_RULE_LABELS,
  type EligibilityRuleType,
} from "@/lib/voucherFunds";
import {
  resolveVoucherRecipientUsername,
  USERNAME_ERROR_MESSAGES,
} from "@/lib/voucherUsername";

export interface VoucherGrantRequirement {
  label: string;
  satisfied: boolean;
}

export interface VoucherGrantPreview {
  eligible: boolean;
  requirements: VoucherGrantRequirement[];
  message: string;
  code?: string;
  member: {
    username: string;
    hubUserId: string;
    canonicalId: string;
  } | null;
}

interface RuleSet {
  mode: "all" | "any";
  rules: Array<Record<string, unknown>>;
}

function validDays(value: unknown, maximum: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= maximum;
}

async function evaluateRule(
  rule: Record<string, unknown>,
  member: { hubUserId: string; canonicalId: string },
  merchantId: string,
  profileCountryCode: string | null,
): Promise<boolean> {
  switch (rule.type) {
    case "country_in": {
      const countries = Array.isArray(rule.countries) ? rule.countries : [];
      return Boolean(profileCountryCode && countries.includes(profileCountryCode));
    }
    case "profile_country_set":
      return Boolean(profileCountryCode);
    case "pass_activated": {
      const { count } = await supabase
        .from("hub_user_passes")
        .select("user_id", { count: "exact", head: true })
        .eq("user_id", member.hubUserId);
      return (count ?? 0) > 0;
    }
    case "minimum_account_age_days": {
      if (!validDays(rule.days, 3650)) return false;
      const { data, error } = await supabase.auth.admin.getUserById(member.hubUserId);
      if (error || !data.user?.created_at) return false;
      return Date.now() - new Date(data.user.created_at).getTime() >= rule.days * 86_400_000;
    }
    case "verified_activity_completed": {
      if (typeof rule.templateKey !== "string") return false;
      const { count } = await supabase
        .from("events")
        .select("id", { count: "exact", head: true })
        .eq("event_type", rule.templateKey)
        .eq("user_id", member.hubUserId);
      return (count ?? 0) > 0;
    }
    case "first_funded_voucher": {
      const { count } = await supabase
        .from("voucher_claims")
        .select("id", { count: "exact", head: true })
        .eq("canonical_id", member.canonicalId);
      return (count ?? 0) === 0;
    }
    case "no_prior_merchant_redemption": {
      const { count } = await supabase
        .from("voucher_redemptions")
        .select("id", { count: "exact", head: true })
        .eq("merchant_id", merchantId)
        .eq("hub_user_id", member.hubUserId);
      return (count ?? 0) === 0;
    }
    case "fund_claim_cooldown": {
      if (!validDays(rule.days, 365)) return false;
      const since = new Date(Date.now() - rule.days * 86_400_000).toISOString();
      const { count } = await supabase
        .from("voucher_claims")
        .select("id", { count: "exact", head: true })
        .eq("canonical_id", member.canonicalId)
        .gte("claimed_at", since);
      return (count ?? 0) === 0;
    }
    default:
      return false;
  }
}

export async function previewVoucherGrant(
  allocationId: string,
  memberUsername: string,
): Promise<VoucherGrantPreview> {
  const resolution = await resolveVoucherRecipientUsername(memberUsername);
  if (!resolution.ok) {
    return {
      eligible: false,
      code: resolution.errorCode,
      message: USERNAME_ERROR_MESSAGES[resolution.errorCode],
      requirements: [{ label: "Active Akiba username resolves to one member", satisfied: false }],
      member: null,
    };
  }

  const member = {
    username: resolution.username,
    hubUserId: resolution.hubUserId,
    canonicalId: resolution.canonicalId,
  };

  const [{ data: allocation }, { data: availability }, { data: profile }] = await Promise.all([
    supabase
      .from("voucher_funding_allocations")
      .select("id, program_id, merchant_id, state, distribution_modes, claim_starts_at, claim_ends_at, max_reimbursement_minor, eligibility_rule_set_id")
      .eq("id", allocationId)
      .maybeSingle(),
    supabase
      .from("v_voucher_funding_allocation_availability")
      .select("quantity_remaining, available_budget_minor")
      .eq("allocation_id", allocationId)
      .maybeSingle(),
    supabase
      .from("hub_user_profiles")
      .select("country_code")
      .eq("user_id", member.hubUserId)
      .maybeSingle(),
  ]);

  if (!allocation) {
    return {
      eligible: false,
      code: "ALLOCATION_NOT_FOUND",
      message: "This voucher allocation no longer exists.",
      requirements: [{ label: "Voucher allocation exists", satisfied: false }],
      member,
    };
  }

  const [{ data: program }, { data: merchant }, ruleSetResult] = await Promise.all([
    supabase
      .from("voucher_funding_programs")
      .select("state, starts_at, ends_at, country_code")
      .eq("id", allocation.program_id)
      .maybeSingle(),
    supabase.from("partners").select("status").eq("id", allocation.merchant_id).maybeSingle(),
    allocation.eligibility_rule_set_id
      ? supabase
          .from("voucher_eligibility_rule_sets")
          .select("mode, rules")
          .eq("id", allocation.eligibility_rule_set_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const now = Date.now();
  const allocationLive = ["active", "scheduled"].includes(allocation.state)
    && new Date(allocation.claim_starts_at).getTime() <= now
    && new Date(allocation.claim_ends_at).getTime() > now;
  const programLive = program
    ? ["active", "scheduled"].includes(program.state)
      && new Date(program.starts_at).getTime() <= now
      && new Date(program.ends_at).getTime() > now
    : false;
  const directIssueAllowed = (allocation.distribution_modes ?? []).includes("internal_grant");
  const quantityAvailable = Number(availability?.quantity_remaining ?? 0) > 0;
  const budgetAvailable = Number(availability?.available_budget_minor ?? 0) >= Number(allocation.max_reimbursement_minor ?? 0);
  const profileCountryCode = typeof profile?.country_code === "string" ? profile.country_code.toUpperCase() : null;
  const countryMatches = Boolean(program?.country_code && profileCountryCode === program.country_code);

  const requirements: VoucherGrantRequirement[] = [
    { label: "Active Akiba username resolves to one member", satisfied: true },
    { label: "Allocation is live", satisfied: allocationLive },
    { label: "Parent fund is live", satisfied: programLive },
    { label: "Direct issue is configured", satisfied: directIssueAllowed },
    { label: "Merchant is active", satisfied: merchant?.status === "active" },
    { label: `Profile country matches ${program?.country_code ?? "the fund"}`, satisfied: countryMatches },
    { label: "Voucher quantity remains", satisfied: quantityAvailable },
    { label: "Funded reimbursement budget remains", satisfied: budgetAvailable },
  ];

  const ruleSetCandidate = ruleSetResult.data as Partial<RuleSet> | null;
  const ruleSet = ruleSetCandidate
    && (ruleSetCandidate.mode === "all" || ruleSetCandidate.mode === "any")
    && Array.isArray(ruleSetCandidate.rules)
    && ruleSetCandidate.rules.every((rule) => rule !== null && typeof rule === "object" && !Array.isArray(rule))
    ? ruleSetCandidate as RuleSet
    : null;
  let rulePolicySatisfied = true;
  if (allocation.eligibility_rule_set_id && !ruleSet) {
    requirements.push({ label: "Eligibility policy is available", satisfied: false });
    rulePolicySatisfied = false;
  } else if (ruleSet) {
    const outcomes = await Promise.all(
      ruleSet.rules.map(async (rule) => ({
        label: ELIGIBILITY_RULE_LABELS[rule.type as EligibilityRuleType] ?? "Supported eligibility requirement",
        satisfied: await evaluateRule(rule, member, allocation.merchant_id, profileCountryCode),
      })),
    );
    requirements.push(...outcomes);
    rulePolicySatisfied = ruleSet.mode === "any"
      ? outcomes.some((outcome) => outcome.satisfied)
      : outcomes.every((outcome) => outcome.satisfied);
  }

  const operationallyReady = allocationLive
    && programLive
    && directIssueAllowed
    && merchant?.status === "active"
    && countryMatches
    && quantityAvailable
    && budgetAvailable;
  const eligible = operationallyReady && rulePolicySatisfied;

  return {
    eligible,
    code: eligible ? undefined : "ELIGIBILITY_REQUIREMENTS_NOT_MET",
    message: eligible
      ? "All current requirements are satisfied. Eligibility and funding will be checked again atomically when you issue."
      : "This member or allocation does not currently meet every issuance requirement.",
    requirements,
    member,
  };
}
