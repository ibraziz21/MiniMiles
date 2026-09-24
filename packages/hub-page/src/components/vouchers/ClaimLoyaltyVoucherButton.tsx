"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import clsx from "clsx";
import { MilesAmount } from "@/components/MilesIcon";
import { VoucherEligibilityModal, type EligibilityRuleView } from "@/components/vouchers/VoucherEligibilityModal";
import type { VoucherClaimFriction, VoucherUsePlan } from "@/lib/vouchers/claimIntent";

type LoyaltyQualificationOutcome = {
  type: "merchant_purchase_count" | "merchant_net_spend_kes";
  minimum: number;
  actual: number | null;
  satisfied: boolean;
};

type EligibilityResponse = {
  eligible: boolean;
  alreadyClaimed: boolean;
  offerAvailable: boolean;
  acquisition: { mode: "miles" | "free"; milesCost: number; sufficientMiles: boolean };
  qualification: { mode: "any" | "all"; customerCopy: string; progress: LoyaltyQualificationOutcome[] } | null;
  claimFriction?: VoucherClaimFriction | null;
  error?: string;
};

function outcomeLabel(outcome: LoyaltyQualificationOutcome): string {
  if (outcome.type === "merchant_purchase_count") {
    return `Make at least ${outcome.minimum} purchases — ${outcome.actual ?? 0} so far`;
  }
  return `Spend at least KES ${outcome.minimum.toLocaleString("en-KE")} — KES ${(outcome.actual ?? 0).toLocaleString("en-KE")} so far`;
}

function claimErrorMessage(status: number, code?: string, serverMessage?: string): string {
  if (status === 401) return "Sign in to claim";
  if (status === 404) return "This offer is no longer available";
  if (code === "ALREADY_CLAIMED") return "You've already claimed this offer";
  if (code === "IDEMPOTENCY_CONFLICT") return "That claim request conflicted — please retry";
  if (code === "INVENTORY_EXHAUSTED") return "This offer has run out";
  if (code === "QUALIFICATION_NOT_MET") return "You don't meet the requirements for this offer yet";
  if (code === "INSUFFICIENT_MILES") return "You don't have enough Miles for this offer";
  if (code === "OWNER_IDENTITY_UNAVAILABLE") return "We couldn't verify your account for this claim";
  if (status === 502 || status === 503) return "Could not reach the voucher service — please try again";
  return serverMessage ?? "Something went wrong. Please try again.";
}

/** Loyalty-qualified-vouchers-spec.md §14 claim — eligibility-gated, free or Miles-priced. */
export function ClaimLoyaltyVoucherButton({
  templateId,
  isSignedIn,
  alreadyClaimed,
  locked,
  customerCopy,
  merchantName,
  endsAt,
  acquisitionMode,
  milesCost,
}: {
  templateId: string;
  isSignedIn: boolean;
  alreadyClaimed: boolean;
  /** Server-rendered snapshot, purely for the button's idle label — the click always re-checks live. */
  locked: boolean;
  customerCopy: string | null;
  merchantName?: string | null;
  endsAt?: string | null;
  acquisitionMode: "miles" | "free";
  milesCost: number;
}) {
  const router = useRouter();
  type Status = "idle" | "checking" | "eligible" | "ineligible" | "already_claimed" | "claiming" | "claimed" | "error";
  const [status, setStatus] = useState<Status>(alreadyClaimed ? "already_claimed" : "idle");
  const [rules, setRules] = useState<EligibilityRuleView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [voucherId, setVoucherId] = useState<string | null>(null);
  const [friction, setFriction] = useState<VoucherClaimFriction | null>(null);
  const [intentConfirmed, setIntentConfirmed] = useState(false);
  const [usePlan, setUsePlan] = useState<VoucherUsePlan | "">("");

  const modalOpen = ["checking", "eligible", "ineligible", "claiming", "error"].includes(status);
  const endsDate = endsAt ? new Date(endsAt) : null;
  const expiryLabel = endsDate && Number.isFinite(endsDate.getTime())
    ? endsDate.toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })
    : null;

  function closeModal() {
    if (status === "claiming") return;
    setStatus("idle");
    setError(null);
    setRules([]);
    setIntentConfirmed(false);
    setUsePlan("");
  }

  async function handleStartClaim() {
    if (!isSignedIn) {
      router.push("/login");
      return;
    }

    setStatus("checking");
    setError(null);
    setRules([]);
    setIntentConfirmed(false);
    setUsePlan("");

    try {
      const res = await fetch(`/api/shop/vouchers/loyalty/${templateId}/eligibility`, { cache: "no-store" });
      const data = (await res.json()) as Partial<EligibilityResponse>;
      if (!res.ok) {
        setStatus("error");
        setError(claimErrorMessage(res.status, undefined, data.error));
        return;
      }
      if (data.alreadyClaimed) {
        setStatus("already_claimed");
        return;
      }
      setFriction(data.claimFriction ?? null);

      const outcomeRules: EligibilityRuleView[] = (data.qualification?.progress ?? []).map((outcome) => ({
        label: outcomeLabel(outcome),
        passed: outcome.satisfied,
      }));
      if (data.acquisition?.mode === "miles") {
        outcomeRules.push({
          label: "Your AkibaMiles balance covers this reward",
          passed: data.acquisition.sufficientMiles,
        });
      }
      setRules(outcomeRules);

      if (data.eligible && (data.acquisition?.mode !== "miles" || data.acquisition.sufficientMiles) && data.offerAvailable !== false) {
        setStatus("eligible");
      } else {
        setStatus("ineligible");
      }
    } catch {
      setStatus("error");
      setError("Could not check eligibility right now. Please try again.");
    }
  }

  async function handleClaim() {
    setStatus("claiming");
    setError(null);

    try {
      const res = await fetch(`/api/shop/vouchers/loyalty/${templateId}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent_confirmed: intentConfirmed, use_plan: usePlan || null }),
      });
      const data = (await res.json()) as { voucherId?: string; error?: string; code?: string };
      if (!res.ok) {
        setStatus("error");
        setError(claimErrorMessage(res.status, data.code, data.error));
        return;
      }
      setVoucherId(data.voucherId ?? null);
      setStatus("claimed");
    } catch {
      setStatus("error");
      setError("Something went wrong. Please try again.");
    }
  }

  if (status === "claimed") {
    return (
      <a href={voucherId ? `/vouchers/${voucherId}` : "/vouchers?tab=active"} className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full bg-akiba-tint px-4 py-2.5 text-sm font-semibold text-akiba-teal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal focus-visible:ring-offset-2">
        <CheckCircle2 className="h-4 w-4" /> Claimed — view voucher
      </a>
    );
  }

  if (status === "already_claimed") {
    return <a href="/vouchers?tab=active" className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full bg-akiba-card px-4 py-2.5 text-sm font-semibold text-akiba-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal focus-visible:ring-offset-2">Already claimed — view in My vouchers</a>;
  }

  const idleLabel = !isSignedIn
    ? "Sign in to claim"
    : locked
      ? "Check my progress"
      : acquisitionMode === "free"
        ? "Claim free"
        : null;

  return (
    <div>
      <button
        type="button"
        onClick={handleStartClaim}
        disabled={status === "checking" || status === "claiming"}
        className={clsx(
          "flex min-h-11 w-full items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal focus-visible:ring-offset-2",
          status === "checking" || status === "claiming"
            ? "cursor-not-allowed bg-akiba-teal/60 text-white"
            : "bg-akiba-teal text-white hover:bg-akiba-teal/90 active:scale-[0.98]",
        )}
      >
        {status === "checking" ? (
          <><Loader2 className="h-4 w-4 animate-spin" /> Checking…</>
        ) : status === "claiming" ? (
          <><Loader2 className="h-4 w-4 animate-spin" /> Claiming…</>
        ) : idleLabel ?? (
          <><MilesAmount amount={milesCost} size="xs" className="text-white [&_svg]:fill-white" /> Get voucher</>
        )}
      </button>

      <VoucherEligibilityModal
        open={modalOpen}
        state={status === "checking" ? "checking" : status === "eligible" ? "eligible" : status === "ineligible" ? "ineligible" : status === "claiming" ? "submitting" : "error"}
        rules={rules}
        error={error}
        eligibilitySummary={customerCopy}
        merchantName={merchantName}
        expiryLabel={expiryLabel}
        friction={friction}
        intentConfirmed={intentConfirmed}
        usePlan={usePlan}
        onIntentConfirmedChange={setIntentConfirmed}
        onUsePlanChange={setUsePlan}
        onConfirm={handleClaim}
        onClose={closeModal}
        confirmLabel={acquisitionMode === "free" ? "Confirm and claim voucher" : (
          <span className="inline-flex items-center gap-1.5">
            Confirm for <MilesAmount amount={milesCost} size="sm" className="text-white [&_svg]:fill-white" />
          </span>
        )}
        details={acquisitionMode === "miles" ? (
          <div className="mt-4 flex items-center justify-between rounded-2xl bg-akiba-card px-4 py-3 text-sm text-akiba-muted">
            <span>Miles price</span>
            <MilesAmount amount={milesCost} size="sm" className="text-akiba-ink" />
          </div>
        ) : null}
      />
    </div>
  );
}
