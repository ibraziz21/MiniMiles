"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import clsx from "clsx";
import { MilesAmount } from "@/components/MilesIcon";

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
}: {
  templateId: string;
  milesCost: number;
  isSignedIn: boolean;
}) {
  const router = useRouter();

  type RedeemStatus = "idle" | "quoting" | "confirming" | "loading" | "error" | "queued";
  const [redeemStatus, setRedeemStatus] = useState<RedeemStatus>("idle");
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [queuedVoucherId, setQueuedVoucherId] = useState<string | null>(null);

  async function handleRedeem() {
    if (!isSignedIn) {
      router.push("/login");
      return;
    }
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
        return;
      }
      router.push(`/vouchers/${data.voucher!.id}`);
    } catch {
      setRedeemStatus("error");
      setRedeemError("Something went wrong. Please try again.");
    }
  }

  const busy = redeemStatus === "loading" || redeemStatus === "quoting" || redeemStatus === "queued";

  return (
    <div>
      {redeemStatus === "error" && redeemError && (
        <div className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {redeemError}
          {redeemError === "Sign in to redeem" && (
            <a href="/login" className="ml-1 underline">Sign in</a>
          )}
          {redeemError === "Connect a wallet first" && (
            <a href="/me" className="ml-1 underline">Go to profile</a>
          )}
        </div>
      )}

      {redeemStatus === "queued" && (
        <div className="mb-2 rounded-lg bg-akiba-tint px-3 py-2 text-xs text-akiba-teal">
          Voucher processing.
          {queuedVoucherId && (
            <a href={`/vouchers/${queuedVoucherId}`} className="ml-1 underline">Track status</a>
          )}
        </div>
      )}

      <button
        onClick={handleRedeem}
        disabled={busy}
        className={clsx(
          "flex w-full items-center justify-center gap-2 rounded-full py-2.5 text-sm font-semibold transition",
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

      {(redeemStatus === "confirming" || redeemStatus === "loading") && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
          <div className="w-full max-w-md rounded-t-3xl bg-white p-6 sm:rounded-3xl">
            <h3 className="text-base font-bold text-akiba-ink">Confirm your purchase</h3>
            {quote && (
              <div className="mt-3 space-y-1.5 text-sm text-akiba-muted">
                {quote.ledger_points > 0 && (
                  <p><span className="font-semibold text-akiba-ink">{quote.ledger_points} Miles</span> from your balance</p>
                )}
                {quote.onchain_points > 0 && (
                  <p>
                    <span className="font-semibold text-akiba-ink">{quote.onchain_points} Miles</span>{" "}
                    will be burned from{" "}
                    {quote.wallet_address ? `${quote.wallet_address.slice(0, 6)}…${quote.wallet_address.slice(-4)}` : "your linked wallet"}
                  </p>
                )}
              </div>
            )}
            <button
              onClick={handleConfirm}
              disabled={redeemStatus === "loading"}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-akiba-teal py-2.5 text-sm font-semibold text-white transition active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-akiba-teal/60"
            >
              {redeemStatus === "loading" ? (<><Loader2 className="h-4 w-4 animate-spin" /> Confirming…</>) : "Yes, confirm"}
            </button>
            <button
              onClick={() => setRedeemStatus("idle")}
              disabled={redeemStatus === "loading"}
              className="mt-2 w-full py-2 text-sm font-medium text-akiba-muted"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
