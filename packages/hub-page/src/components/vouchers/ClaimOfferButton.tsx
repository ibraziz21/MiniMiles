"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import clsx from "clsx";
import { requirementCopy, type EligibilityPreview } from "@/lib/akiba/voucherFundingEligibility";
import { VoucherEligibilityModal, type EligibilityRuleView } from "@/components/vouchers/VoucherEligibilityModal";
import type { VoucherClaimFriction, VoucherUsePlan } from "@/lib/vouchers/claimIntent";

function claimErrorMessage(status: number, code?: string, serverMessage?: string): string {
  if (status === 401) return "Sign in to claim";
  if (status === 404) return "This offer is no longer available";
  if (code === "ALREADY_CLAIMED" || (status === 409 && !code)) return "You've already claimed this offer";
  if (status === 422) return serverMessage ?? "You don't meet the requirements for this offer yet";
  if (status === 502 || status === 503) return "Could not reach the voucher service — please try again";
  return serverMessage ?? "Something went wrong. Please try again.";
}

/** Free, eligibility-gated Akiba-funded voucher claim. */
export function ClaimOfferButton({
  allocationId,
  isSignedIn,
  alreadyClaimed,
  eligibilitySummary,
  merchantName,
  claimEndsAt,
}: {
  allocationId: string;
  isSignedIn: boolean;
  alreadyClaimed: boolean;
  eligibilitySummary?: string | null;
  merchantName?: string | null;
  claimEndsAt?: string | null;
}) {
  const router = useRouter();
  type Status = "idle" | "checking" | "eligible" | "ineligible" | "already_claimed" | "claiming" | "claimed" | "error";
  const [status, setStatus] = useState<Status>(alreadyClaimed ? "already_claimed" : "idle");
  const [requirements, setRequirements] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [voucherId, setVoucherId] = useState<string | null>(null);
  const [friction, setFriction] = useState<VoucherClaimFriction | null>(null);
  const [intentConfirmed, setIntentConfirmed] = useState(false);
  const [usePlan, setUsePlan] = useState<VoucherUsePlan | "">("");

  const modalOpen = ["checking", "eligible", "ineligible", "claiming", "error"].includes(status);
  const expiryDate = claimEndsAt ? new Date(claimEndsAt) : null;
  const expiryLabel = expiryDate && Number.isFinite(expiryDate.getTime())
    ? expiryDate.toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })
    : null;

  function closeModal() {
    if (status === "claiming") return;
    setStatus("idle");
    setError(null);
    setRequirements([]);
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
    setRequirements([]);
    setIntentConfirmed(false);
    setUsePlan("");

    try {
      const res = await fetch(`/api/voucher-funding/${allocationId}/eligibility`, { cache: "no-store" });
      const data = (await res.json()) as Partial<EligibilityPreview> & { error?: string };
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
      if (data.eligible) {
        setStatus("eligible");
      } else {
        setRequirements(Array.isArray(data.requirementsRemaining) ? data.requirementsRemaining : []);
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
      const res = await fetch(`/api/voucher-funding/${allocationId}/claim`, {
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
      <a href={voucherId ? `/vouchers/${voucherId}` : "/vouchers?tab=active"} className="flex w-full items-center justify-center gap-1.5 rounded-full bg-akiba-tint py-2.5 text-sm font-semibold text-akiba-teal">
        <CheckCircle2 className="h-4 w-4" /> Claimed — view voucher
      </a>
    );
  }

  if (status === "already_claimed") {
    return <a href="/vouchers?tab=active" className="flex w-full items-center justify-center gap-1.5 rounded-full bg-akiba-card py-2.5 text-sm font-semibold text-akiba-muted">Already claimed — view in My vouchers</a>;
  }

  const rules: EligibilityRuleView[] = status === "ineligible"
    ? requirements.map((requirement) => ({
        label: requirementCopy(requirement).text,
        passed: false,
        href: requirementCopy(requirement).href,
        cta: requirementCopy(requirement).cta,
      }))
    : status === "eligible" || status === "claiming"
      ? [{ label: "Your account meets this offer’s eligibility rules", passed: true }]
      : [];

  return (
    <div>
      <button
        type="button"
        onClick={handleStartClaim}
        disabled={status === "checking" || status === "claiming"}
        className={clsx(
          "flex w-full items-center justify-center gap-2 rounded-full py-2.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal focus-visible:ring-offset-2",
          status === "checking" || status === "claiming"
            ? "cursor-not-allowed bg-akiba-teal/60 text-white"
            : "bg-akiba-teal text-white hover:bg-akiba-teal/90 active:scale-[0.98]",
        )}
      >
        {status === "checking" ? <><Loader2 className="h-4 w-4 animate-spin" /> Checking…</> : status === "claiming" ? <><Loader2 className="h-4 w-4 animate-spin" /> Claiming…</> : !isSignedIn ? "Sign in to claim" : "Check eligibility & claim"}
      </button>

      <VoucherEligibilityModal
        open={modalOpen}
        state={status === "checking" ? "checking" : status === "eligible" ? "eligible" : status === "ineligible" ? "ineligible" : status === "claiming" ? "submitting" : "error"}
        rules={rules}
        error={error}
        eligibilitySummary={eligibilitySummary}
        merchantName={merchantName}
        expiryLabel={expiryLabel}
        friction={friction}
        intentConfirmed={intentConfirmed}
        usePlan={usePlan}
        onIntentConfirmedChange={setIntentConfirmed}
        onUsePlanChange={setUsePlan}
        onConfirm={handleClaim}
        onClose={closeModal}
        confirmLabel="Confirm and claim voucher"
      />
    </div>
  );
}
