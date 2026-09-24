"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import clsx from "clsx";
import { MilesAmount } from "@/components/MilesIcon";
import { recordDealViewProof } from "@/lib/akiba/dealViewProof";
import { VoucherEligibilityModal, type EligibilityRuleView } from "@/components/vouchers/VoucherEligibilityModal";
import type { VoucherClaimFriction, VoucherUsePlan } from "@/lib/vouchers/claimIntent";

function redeemErrorMessage(status: number, serverMessage?: string): string {
  if (status === 401) return "Sign in to redeem";
  if (status === 400 && serverMessage?.toLowerCase().includes("wallet")) return "Connect a wallet first";
  if (status === 409) return "Price or availability changed — please try again";
  if (status === 422) return "Not enough AkibaMiles";
  if (status === 429) return "Try again later";
  if (status === 503) return "Could not verify your balance — please retry";
  return serverMessage ?? "Something went wrong. Please try again.";
}

type Quote = {
  quote_id: string;
  ledger_points: number;
  onchain_points: number;
  total_points: number;
  wallet_address?: string | null;
  claim_friction: VoucherClaimFriction;
};

/**
 * The single client-side entry point into the canonical quote → confirm →
 * redeem flow (`/api/shop/vouchers/quote`, `/api/shop/vouchers/redeem`).
 * Used by both the `/vouchers` catalog and the merchant directory page so
 * there is exactly one voucher issuance path (see
 * merchant-directory-in-store-discovery-spec.md §9).
 */
export function GetVoucherButton({
  templateId,
  milesCost,
  isSignedIn,
  onInteract,
  onQueued,
  sourceSurface,
}: {
  templateId: string;
  milesCost: number;
  isSignedIn: boolean;
  /** Called once the member's first real redeem attempt starts (signed in). */
  onInteract?: () => void;
  /** Called when redemption is accepted but issuance is still processing
   *  (the async on-chain burn hasn't confirmed yet) — distinct from actually
   *  acquiring the voucher, which VoucherDetailView reports once status
   *  reaches "issued" (next-reward-progress-v1-spec.md §11). */
  onQueued?: () => void;
  /** Tags the /vouchers/{id} redirect so the detail page can attribute an
   *  eventual acquisition back to the surface that started it. */
  sourceSurface?: "home" | "me";
}) {
  const router = useRouter();

  type RedeemStatus = "idle" | "quoting" | "confirming" | "ineligible" | "loading" | "error" | "queued";
  const [redeemStatus, setRedeemStatus] = useState<RedeemStatus>("idle");
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [queuedVoucherId, setQueuedVoucherId] = useState<string | null>(null);
  const [intentConfirmed, setIntentConfirmed] = useState(false);
  const [usePlan, setUsePlan] = useState<VoucherUsePlan | "">("");

  const modalOpen = ["quoting", "confirming", "ineligible", "loading", "error"].includes(redeemStatus);

  function closeModal() {
    if (redeemStatus === "loading") return;
    setRedeemStatus("idle");
    setRedeemError(null);
    setQuote(null);
    setIntentConfirmed(false);
    setUsePlan("");
  }

  async function handleRedeem() {
    if (!isSignedIn) {
      router.push("/login");
      return;
    }
    // Selecting the voucher's primary action is a genuine offer interaction
    // (spec §8.1) — record it regardless of where the member arrived from.
    recordDealViewProof(templateId);
    onInteract?.();
    setRedeemStatus("quoting");
    setRedeemError(null);
    setQuote(null);
    setIntentConfirmed(false);
    setUsePlan("");

    try {
      const res = await fetch("/api/shop/vouchers/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template_id: templateId }),
      });
      const data = (await res.json()) as Quote & { error?: string };
      if (!res.ok) {
        setRedeemStatus([400, 403, 409, 422].includes(res.status) ? "ineligible" : "error");
        setRedeemError(redeemErrorMessage(res.status, data.error));
        return;
      }
      setQuote(data);
      setRedeemStatus("confirming");
    } catch {
      setRedeemStatus("error");
      setRedeemError("Something went wrong. Please try again.");
    }
  }

  async function handleConfirm() {
    if (!quote) return;
    setRedeemStatus("loading");
    setRedeemError(null);

    try {
      const res = await fetch("/api/shop/vouchers/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template_id: templateId,
          quote_id: quote.quote_id,
          confirmed: true,
          intent_confirmed: intentConfirmed,
          use_plan: usePlan || null,
        }),
      });
      const data = (await res.json()) as { voucher?: { id: string }; queued?: boolean; error?: string };
      if (!res.ok) {
        setRedeemStatus("error");
        setRedeemError(redeemErrorMessage(res.status, data.error));
        return;
      }
      if (data.queued) {
        setQueuedVoucherId(data.voucher?.id ?? null);
        setRedeemStatus("queued");
        onQueued?.();
        return;
      }
      const suffix = sourceSurface ? `?source_surface=${sourceSurface}` : "";
      router.push(`/vouchers/${data.voucher!.id}${suffix}`);
    } catch {
      setRedeemStatus("error");
      setRedeemError("Something went wrong. Please try again.");
    }
  }

  const busy = redeemStatus === "loading" || redeemStatus === "quoting" || redeemStatus === "queued";

  return (
    <div>
      {redeemStatus === "queued" && (
        <div role="status" aria-live="polite" className="mb-2 rounded-lg bg-akiba-tint px-3 py-2 text-xs text-akiba-teal">
          Voucher processing.
          {queuedVoucherId && (
            <a
              href={`/vouchers/${queuedVoucherId}${sourceSurface ? `?source_surface=${sourceSurface}` : ""}`}
              className="ml-1 underline"
            >
              Track status
            </a>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={handleRedeem}
        disabled={busy}
        className={clsx(
          "flex w-full items-center justify-center gap-2 rounded-full py-2.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal focus-visible:ring-offset-2",
          busy
            ? "cursor-not-allowed bg-akiba-teal/60 text-white"
            : "bg-akiba-teal text-white hover:bg-akiba-teal/90 active:scale-[0.98]"
        )}
      >
        {redeemStatus === "quoting" ? (
          <><Loader2 className="h-4 w-4 animate-spin" /> Checking balance…</>
        ) : redeemStatus === "loading" ? (
          <><Loader2 className="h-4 w-4 animate-spin" /> Redeeming…</>
        ) : redeemStatus === "queued" ? (
          "Voucher queued"
        ) : !isSignedIn ? (
          "Sign in to get voucher"
        ) : (
          <>
            <MilesAmount amount={milesCost} size="xs" className="text-white [&_svg]:fill-white" />
            Get voucher
          </>
        )}
      </button>

      <VoucherEligibilityModal
        open={modalOpen}
        state={redeemStatus === "quoting" ? "checking" : redeemStatus === "confirming" ? "eligible" : redeemStatus === "ineligible" ? "ineligible" : redeemStatus === "loading" ? "submitting" : "error"}
        rules={quote ? [
          { label: "This voucher is available", passed: true },
          { label: "Available for your country", passed: true },
          { label: "You have enough AkibaMiles", passed: true },
        ] satisfies EligibilityRuleView[] : redeemStatus === "ineligible" && redeemError ? [{
          label: redeemError,
          passed: false,
          href: redeemError === "Connect a wallet first" ? "/me" : redeemError === "Not enough AkibaMiles" ? "/earn" : undefined,
          cta: redeemError === "Connect a wallet first" ? "Go to profile" : redeemError === "Not enough AkibaMiles" ? "Earn more Miles" : undefined,
        }] : []}
        error={redeemError}
        friction={quote?.claim_friction}
        intentConfirmed={intentConfirmed}
        usePlan={usePlan}
        onIntentConfirmedChange={setIntentConfirmed}
        onUsePlanChange={setUsePlan}
        onConfirm={handleConfirm}
        onClose={closeModal}
        confirmLabel="Confirm and get voucher"
        details={quote ? (
          <div className="mt-4 rounded-2xl bg-akiba-card px-4 py-3 text-sm text-akiba-muted">
            {quote.ledger_points > 0 && <p className="flex items-center gap-1"><MilesAmount amount={quote.ledger_points} size="sm" className="text-akiba-ink" /> from your balance</p>}
            {quote.onchain_points > 0 && <p className="mt-1"><MilesAmount amount={quote.onchain_points} size="sm" className="text-akiba-ink" /> will be burned from {quote.wallet_address ? `${quote.wallet_address.slice(0, 6)}…${quote.wallet_address.slice(-4)}` : "your linked wallet"}</p>}
          </div>
        ) : null}
      />
    </div>
  );
}
