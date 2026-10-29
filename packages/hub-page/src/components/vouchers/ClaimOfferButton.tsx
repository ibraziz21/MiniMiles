"use client";

import type { CustomerVoucherEntitlement } from "@/lib/vouchers/customerEntitlement";
import { entitlementDates } from "@/lib/vouchers/customerEntitlement";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
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
  entitlement,
  claimStartsAt,
  claimsOpen = true,
}: {
  allocationId: string;
  isSignedIn: boolean;
  alreadyClaimed: boolean;
  eligibilitySummary?: string | null;
  entitlement: CustomerVoucherEntitlement;
  claimStartsAt?: string;
  claimsOpen?: boolean;
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

  const [committedExpiry, setCommittedExpiry] = useState<string | null>(null);
  const [successDismissed, setSuccessDismissed] = useState(false);
  const triggerRef = useRef<HTMLAnchorElement | HTMLButtonElement | null>(null);
  const requestEpoch = useRef(0);
  useEffect(() => () => { requestEpoch.current += 1; }, []);
  const modalOpen = ["checking", "eligible", "ineligible", "claiming", "error"].includes(status) || (status === "claimed" && !successDismissed);
  const displayedEntitlement: CustomerVoucherEntitlement = status === "claimed"
    ? { ...entitlement, timing: { kind: "issued", expiresAt: committedExpiry } } : entitlement;

  function closeModal() {
    if (status === "claiming") return;
    requestEpoch.current += 1;
    if (status === "claimed") { setSuccessDismissed(true); return; }
    setStatus("idle"); setError(null); setRequirements([]);
    setIntentConfirmed(false); setUsePlan("");
  }

  async function handleStartClaim() {
    if (!isSignedIn) { router.push("/login"); return; }
    const epoch = ++requestEpoch.current;
    setStatus("checking"); setError(null); setRequirements([]);
    setIntentConfirmed(false); setUsePlan("");
    try {
      const res = await fetch(`/api/voucher-funding/${allocationId}/eligibility`, { cache: "no-store" });
      const data = await res.json() as Partial<EligibilityPreview> & { error?: string };
      if (epoch !== requestEpoch.current) return;
      if (!res.ok) { setError(claimErrorMessage(res.status, undefined, data.error)); setStatus("error"); return; }
      if (data.alreadyClaimed) { setStatus("already_claimed"); return; }
      setFriction(data.claimFriction ?? null);
      setRequirements(Array.isArray(data.requirementsRemaining) ? data.requirementsRemaining : []);
      setStatus(data.eligible ? "eligible" : "ineligible");
    } catch {
      if (epoch !== requestEpoch.current) return;
      setStatus("error"); setError("Could not check eligibility right now. Please try again.");
    }
  }

  async function handleClaim() {
    setStatus("claiming"); setError(null);
    try {
      const res = await fetch(`/api/voucher-funding/${allocationId}/claim`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent_confirmed: intentConfirmed, use_plan: usePlan || null }),
      });
      const data = await res.json() as { voucherId?: string; expiresAt?: string; error?: string; code?: string };
      if (!res.ok) { setStatus("error"); setError(claimErrorMessage(res.status, data.code, data.error)); return; }
      setVoucherId(data.voucherId ?? null); setCommittedExpiry(data.expiresAt ?? null); setStatus("claimed");
    } catch {
      setStatus("error"); setError("Something went wrong. Please try again.");
    }
  }

  if (status === "already_claimed") {
    return <a ref={(node) => { triggerRef.current = node; }} href="/vouchers?tab=active" className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full bg-akiba-card py-2.5 text-sm font-semibold text-akiba-muted">Already claimed — view in My vouchers</a>;
  }

  if (!claimsOpen && claimStartsAt) {
    return <p className="rounded-xl bg-akiba-tint px-4 py-3 text-center text-sm font-semibold text-akiba-tealAccessible">Claims open {new Date(claimStartsAt).toLocaleDateString("en-KE", { day: "numeric", month: "short", timeZone: "Africa/Nairobi" })}</p>;
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
      {status === "claimed" ? <div>
        <a ref={(node) => { triggerRef.current = node; }} href={voucherId ? `/vouchers/${voucherId}` : "/vouchers?tab=active"} className="flex min-h-11 w-full items-center justify-center rounded-full bg-akiba-tint px-4 text-sm font-semibold text-akiba-tealAccessible">Claimed — view voucher</a>
        <p role="status" className="mt-2 text-xs text-akiba-muted">{entitlementDates(displayedEntitlement)[0]}</p>
      </div> : <button
        ref={(node) => { triggerRef.current = node; }}
        type="button"
        onClick={handleStartClaim}
        disabled={status === "checking" || status === "claiming"}
        className={clsx(
          "flex w-full items-center justify-center gap-2 min-h-11 rounded-full py-2.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-tealAccessible focus-visible:ring-offset-2",
          status === "checking" || status === "claiming"
            ? "cursor-not-allowed bg-akiba-card text-akiba-muted"
            : "bg-akiba-tealAccessible text-white hover:bg-akiba-tealAccessibleHover active:scale-[0.98]",
        )}
      >
        {status === "checking" ? <><Loader2 className="h-4 w-4 animate-spin" /> Checking…</> : status === "claiming" ? <><Loader2 className="h-4 w-4 animate-spin" /> Claiming…</> : !isSignedIn ? "Sign in to claim" : "Check eligibility & claim"}
      </button>}

      <VoucherEligibilityModal
        open={modalOpen}
        state={status === "claimed" ? "success" : status === "checking" ? "checking" : status === "eligible" ? "eligible" : status === "ineligible" ? "ineligible" : status === "claiming" ? "submitting" : "error"}
        rules={rules}
        error={error}
        eligibilitySummary={eligibilitySummary}
        entitlement={displayedEntitlement}
        successHref={voucherId ? `/vouchers/${voucherId}` : "/vouchers?tab=active"}
        returnFocusRef={triggerRef}
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
