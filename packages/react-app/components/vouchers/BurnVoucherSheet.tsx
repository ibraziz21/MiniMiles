"use client";

// Burn a WON voucher for Miles — three steps in one sheet:
//   1. Tradeoff (marketplace value vs. burn value, irreversible)
//   2. Required one-tap reason (the pilot's key survey)
//   3. Success (Miles credited)
// No reason, no burn — the API rejects reason-less requests.
// See docs/skill-games-voucher-prizes-spec.md §5.

import { useState } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Fire, CheckCircle, Spinner, Warning } from "@phosphor-icons/react";

export type BurnableVoucher = {
  id: string;
  merchantName: string;
  merchantCountry: string | null;
  label: string;          // e.g. "15% off"
  marketplaceMiles: number;
  burnMiles: number;
};

const REASONS: Array<{ key: string; label: string }> = [
  { key: "not_in_country",  label: "I don't live in the merchant's country" },
  { key: "too_far",         label: "The merchant is too far from me" },
  { key: "not_interested",  label: "I'm not interested in their products" },
  { key: "prefer_miles",    label: "I'd rather have Miles" },
  { key: "other",           label: "Other" },
];

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  voucher: BurnableVoucher | null;
  /** Called after a successful burn so the parent can refresh lists/balances. */
  onBurned: (milesCredited: number) => void;
};

export function BurnVoucherSheet({ open, onOpenChange, voucher, onBurned }: Props) {
  const [step, setStep] = useState<"tradeoff" | "reason" | "done">("tradeoff");
  const [reason, setReason] = useState<string | null>(null);
  const [reasonText, setReasonText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [credited, setCredited] = useState<number | null>(null);

  if (!voucher) return null;

  const reset = () => {
    setStep("tradeoff");
    setReason(null);
    setReasonText("");
    setError(null);
    setCredited(null);
  };

  const close = (v: boolean) => {
    if (submitting) return;
    onOpenChange(v);
    if (!v) reset();
  };

  const submit = async () => {
    if (!reason || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/Spend/vouchers/${voucher.id}/burn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason,
          reason_text: reason === "other" ? reasonText : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Burn failed");
      setCredited(data.milesCredited ?? voucher.burnMiles);
      setStep("done");
      onBurned(data.milesCredited ?? voucher.burnMiles);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent side="bottom" className="rounded-t-3xl p-0 overflow-hidden bg-white">
        <div className="px-5 pt-6 pb-8">

          {step === "tradeoff" && (
            <>
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-50">
                <Fire size={24} weight="fill" className="text-orange-500" />
              </div>
              <h2 className="text-center text-lg font-bold text-gray-900">
                Burn this voucher for Miles?
              </h2>
              <p className="mt-2 text-center text-sm text-gray-500 leading-relaxed">
                Your <span className="font-semibold">{voucher.label}</span> voucher at{" "}
                <span className="font-semibold">{voucher.merchantName}</span> is worth{" "}
                <span className="font-semibold">{voucher.marketplaceMiles} Miles</span> in the
                marketplace. Burning gives you{" "}
                <span className="font-bold text-[#238D9D]">{voucher.burnMiles} Miles</span>.
              </p>
              <p className="mt-2 text-center text-xs font-semibold text-orange-500">
                This can't be undone.
              </p>
              <div className="mt-6 space-y-3">
                <button
                  onClick={() => setStep("reason")}
                  className="w-full h-12 rounded-2xl bg-[#238D9D] text-sm font-bold text-white active:scale-[0.98] transition-transform"
                >
                  Continue — burn for {voucher.burnMiles} Miles
                </button>
                <button
                  onClick={() => close(false)}
                  className="w-full h-11 rounded-2xl border border-gray-200 text-sm font-semibold text-gray-600"
                >
                  Keep my voucher
                </button>
              </div>
            </>
          )}

          {step === "reason" && (
            <>
              <h2 className="text-center text-lg font-bold text-gray-900">
                Why are you burning it?
              </h2>
              <p className="mt-1 text-center text-xs text-gray-400">
                One quick answer — it helps us bring rewards closer to you.
              </p>
              <div className="mt-4 space-y-2">
                {REASONS.map((r) => (
                  <button
                    key={r.key}
                    onClick={() => setReason(r.key)}
                    className={`w-full rounded-xl border px-4 py-3 text-left text-sm font-medium transition-colors ${
                      reason === r.key
                        ? "border-[#238D9D] bg-[#F0FDFF] text-[#238D9D]"
                        : "border-gray-200 text-gray-700"
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
                {reason === "other" && (
                  <textarea
                    value={reasonText}
                    onChange={(e) => setReasonText(e.target.value.slice(0, 280))}
                    placeholder="Tell us more (optional)"
                    rows={2}
                    className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-[#238D9D]"
                  />
                )}
              </div>

              {error && (
                <div className="mt-3 flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">
                  <Warning size={14} weight="fill" /> {error}
                </div>
              )}

              <button
                onClick={submit}
                disabled={!reason || submitting}
                className="mt-5 w-full h-12 rounded-2xl bg-[#238D9D] text-sm font-bold text-white disabled:opacity-40 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
              >
                {submitting
                  ? <><Spinner size={16} className="animate-spin" /> Burning…</>
                  : `Confirm burn — get ${voucher.burnMiles} Miles`}
              </button>
            </>
          )}

          {step === "done" && (
            <div className="flex flex-col items-center py-4">
              <CheckCircle size={56} weight="fill" className="text-[#238D9D]" />
              <h2 className="mt-3 text-lg font-bold text-gray-900">
                +{credited ?? voucher.burnMiles} Miles
              </h2>
              <p className="mt-1 text-center text-sm text-gray-500">
                Credited to your balance. Spend them in the marketplace anytime.
              </p>
              <button
                onClick={() => close(false)}
                className="mt-6 w-full h-12 rounded-2xl bg-[#238D9D] text-sm font-bold text-white"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
