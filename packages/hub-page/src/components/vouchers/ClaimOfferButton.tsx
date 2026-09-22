"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, CheckCircle2, Lock } from "lucide-react";
import clsx from "clsx";
import { requirementCopy, type EligibilityPreview } from "@/lib/akiba/voucherFundingEligibility";

function claimErrorMessage(status: number, code?: string, serverMessage?: string): string {
  if (status === 401) return "Sign in to claim";
  if (status === 404) return "This offer is no longer available";
  if (code === "ALREADY_CLAIMED" || (status === 409 && !code)) return "You've already claimed this offer";
  if (status === 422) return serverMessage ?? "You don't meet the requirements for this offer yet";
  if (status === 502 || status === 503) return "Could not reach the voucher service — please try again";
  return serverMessage ?? "Something went wrong. Please try again.";
}

/**
 * Free, eligibility-gated Akiba-funded voucher claim. Checks eligibility up
 * front (Akiba-Platform's real evaluator, not a guess) so a member sees
 * exactly what's missing before they try, instead of only after a rejected
 * claim (akiba-funded-voucher-admin-spec.md §12.2).
 */
export function ClaimOfferButton({
  allocationId,
  isSignedIn,
  alreadyClaimed,
}: {
  allocationId: string;
  isSignedIn: boolean;
  /**
   * Computed server-side (voucher_claims, resolved with the same
   * canonical-id logic Platform uses) — authoritative, so when true this
   * skips the client-side preview fetch entirely. That fetch goes through
   * Platform's own HTTP+JWT+identity-resolution chain to get eligibility
   * *reasons*, which is the right place for that (real business logic this
   * page must not reimplement) — but it's more failure points than
   * necessary just to answer "did they already claim this," which the page
   * can read directly.
   */
  alreadyClaimed: boolean;
}) {
  const router = useRouter();
  type Status = "checking" | "eligible" | "ineligible" | "already_claimed" | "unknown" | "claiming" | "claimed" | "error";
  const [status, setStatus] = useState<Status>(alreadyClaimed ? "already_claimed" : isSignedIn ? "checking" : "unknown");
  const [requirements, setRequirements] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [voucherId, setVoucherId] = useState<string | null>(null);

  useEffect(() => {
    if (!isSignedIn || alreadyClaimed) return;
    let cancelled = false;

    async function checkOnce(): Promise<(Partial<EligibilityPreview> & { error?: string }) | null> {
      try {
        const res = await fetch(`/api/voucher-funding/${allocationId}/eligibility`, { cache: "no-store" });
        if (!res.ok) return null;
        return (await res.json()) as Partial<EligibilityPreview> & { error?: string };
      } catch {
        return null;
      }
    }

    (async () => {
      // A transient blip here (e.g. a session-cookie race right after a
      // redirect/reload) shouldn't permanently mask "already claimed" —
      // retry once before falling back to the fail-open "unknown" state.
      let data = await checkOnce();
      if (!data && !cancelled) {
        await new Promise((r) => setTimeout(r, 700));
        data = await checkOnce();
      }
      if (cancelled) return;
      if (!data) {
        // Preview failed rather than genuinely evaluated ineligible — fail
        // open to letting them try; claim() re-checks safely either way.
        setStatus("unknown");
      } else if (data.alreadyClaimed) {
        setStatus("already_claimed");
      } else if (data.eligible) {
        setStatus("eligible");
      } else if (Array.isArray(data.requirementsRemaining)) {
        setRequirements(data.requirementsRemaining);
        setStatus("ineligible");
      } else {
        setStatus("unknown");
      }
    })();

    return () => { cancelled = true; };
  }, [allocationId, isSignedIn, alreadyClaimed]);

  async function handleClaim() {
    if (!isSignedIn) {
      router.push("/login");
      return;
    }
    setStatus("claiming");
    setError(null);

    try {
      const res = await fetch(`/api/voucher-funding/${allocationId}/claim`, { method: "POST" });
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
      <a
        href={voucherId ? `/vouchers/${voucherId}` : "/vouchers?tab=active"}
        className="flex w-full items-center justify-center gap-1.5 rounded-full bg-akiba-tint py-2.5 text-sm font-semibold text-akiba-teal"
      >
        <CheckCircle2 className="h-4 w-4" /> Claimed — view voucher
      </a>
    );
  }

  if (status === "already_claimed") {
    return (
      <a
        href="/vouchers?tab=active"
        className="flex w-full items-center justify-center gap-1.5 rounded-full bg-akiba-card py-2.5 text-sm font-semibold text-akiba-muted"
      >
        Already claimed — view in My vouchers
      </a>
    );
  }

  if (status === "checking") {
    return (
      <div className="flex w-full items-center justify-center gap-2 rounded-full bg-akiba-card py-2.5 text-sm font-medium text-akiba-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking eligibility…
      </div>
    );
  }

  if (status === "ineligible") {
    return (
      <div className="space-y-2">
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <p className="mb-1 flex items-center gap-1.5 font-semibold">
            <Lock className="h-3.5 w-3.5" /> Not yet eligible
          </p>
          <ul className="space-y-1">
            {requirements.map((r) => {
              const copy = requirementCopy(r);
              return (
                <li key={r} className="flex items-center justify-between gap-2">
                  <span>{copy.text}</span>
                  {copy.href && (
                    <a href={copy.href} className="shrink-0 underline">
                      {copy.cta ?? "Go"}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div>
      {status === "error" && error && (
        <div role="alert" className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
          {error === "Sign in to claim" && (
            <a href="/login" className="ml-1 underline">Sign in</a>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={handleClaim}
        disabled={status === "claiming"}
        className={clsx(
          "flex w-full items-center justify-center gap-2 rounded-full py-2.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal focus-visible:ring-offset-2",
          status === "claiming"
            ? "cursor-not-allowed bg-akiba-teal/60 text-white"
            : "bg-akiba-teal text-white hover:bg-akiba-teal/90 active:scale-[0.98]",
        )}
      >
        {status === "claiming" ? (
          <><Loader2 className="h-4 w-4 animate-spin" /> Claiming…</>
        ) : !isSignedIn ? (
          "Sign in to claim"
        ) : (
          "Claim this offer"
        )}
      </button>
    </div>
  );
}
