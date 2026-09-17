"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import clsx from "clsx";
import { MilesAmount } from "@/components/MilesIcon";
import { recordDealViewProof } from "@/lib/akiba/dealViewProof";
import { useDialogA11y } from "@/hooks/useDialogA11y";

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
  const titleId = useId();

  type RedeemStatus = "idle" | "quoting" | "confirming" | "loading" | "error" | "queued";
  const [redeemStatus, setRedeemStatus] = useState<RedeemStatus>("idle");
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [queuedVoucherId, setQueuedVoucherId] = useState<string | null>(null);

  const sheetOpen = redeemStatus === "confirming" || redeemStatus === "loading";
  // No dismiss while a redeem request is in flight — there's nothing to
  // cancel back to, and an accidental Escape mid-request would be confusing.
  const closeSheet = redeemStatus === "loading" ? undefined : () => setRedeemStatus("idle");
  const sheetRef = useDialogA11y<HTMLDivElement>(sheetOpen, closeSheet);

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

    try {
      const res = await fetch("/api/shop/vouchers/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template_id: templateId }),
      });
      const data = (await res.json()) as Quote & { error?: string };
      if (!res.ok) {
        setRedeemStatus("error");
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
        body: JSON.stringify({ template_id: templateId, quote_id: quote.quote_id, confirmed: true }),
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
      {redeemStatus === "error" && redeemError && (
        <div role="alert" className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {redeemError}
          {redeemError === "Sign in to redeem" && (
            <a href="/login" className="ml-1 underline">Sign in</a>
          )}
          {redeemError === "Connect a wallet first" && (
            <a href="/me" className="ml-1 underline">Go to profile</a>
          )}
          {redeemError === "Not enough AkibaMiles" && (
            <a href="/earn" className="ml-1 underline">Earn more Miles</a>
          )}
        </div>
      )}

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

      {sheetOpen && (
        // z-[60]: above the mobile BottomNav (z-50, including its elevated
        // center Pass button) — otherwise
        // this bottom sheet's Confirm/Cancel buttons render underneath the
        // nav bar and become untappable on mobile. The sheet itself reserves
        // the safe-area/home-indicator space BottomNav also reserves, plus
        // extra clearance so its content never sits behind the nav bar.
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
        >
          {closeSheet && (
            <button
              type="button"
              className="absolute inset-0"
              onClick={closeSheet}
              aria-label="Dismiss"
            />
          )}
          <div
            ref={sheetRef}
            tabIndex={-1}
            className="relative max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] focus:outline-none sm:max-h-[90vh] sm:rounded-3xl sm:pb-6"
          >
            <h3 id={titleId} className="text-base font-bold text-akiba-ink">Confirm voucher redemption</h3>
            {quote && (
              <div className="mt-3 space-y-1.5 text-sm text-akiba-muted">
                {quote.ledger_points > 0 && (
                  <p className="flex items-center gap-1">
                    <MilesAmount amount={quote.ledger_points} size="sm" className="text-akiba-ink" /> from your balance
                  </p>
                )}
                {quote.onchain_points > 0 && (
                  <p>
                    <MilesAmount amount={quote.onchain_points} size="sm" className="text-akiba-ink" />{" "}
                    will be burned from{" "}
                    {quote.wallet_address ? `${quote.wallet_address.slice(0, 6)}…${quote.wallet_address.slice(-4)}` : "your linked wallet"}
                  </p>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={handleConfirm}
              disabled={redeemStatus === "loading"}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-akiba-teal py-2.5 text-sm font-semibold text-white transition active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-akiba-teal/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal focus-visible:ring-offset-2"
            >
              {redeemStatus === "loading" ? (<><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Confirming…</>) : "Yes, confirm"}
            </button>
            <button
              type="button"
              onClick={() => setRedeemStatus("idle")}
              disabled={redeemStatus === "loading"}
              className="mt-2 w-full py-2 text-sm font-medium text-akiba-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
