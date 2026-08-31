"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  normalizeDecimalString,
  REJECTION_CODES,
  REJECTION_CODE_LABELS,
  type AttemptStatus,
  type RejectionCode,
} from "@/lib/subscriptionPayments";

type Props = {
  attemptId: string;
  version: number;
  status: AttemptStatus;
  canDecide: boolean;
  isSuperAdmin: boolean;
  claimedByMe: boolean;
  claimedByName: string | null;
  staleClaim: boolean;
  hasEvidence: boolean;
  expectedAmount: string | null;
  balance: string | null;
  submittedAmount: string | null;
  providerReferenceMasked: string | null;
  paymentDate: string | null;
};

const CHECKLIST = [
  "Funds are visible in the AKIBA ECOSYSTEMS LTD NCBA account.",
  "Provider reference matches the bank / M-Pesa record.",
  "Confirmed currency is KES.",
  "Confirmed amount exactly equals the outstanding invoice balance.",
  "The reference has not already confirmed another payment.",
  "The invoice and intended subscription effect are correct.",
];

export function SubscriptionPaymentReview(props: Props) {
  const router = useRouter();
  const { attemptId, version, status, canDecide, isSuperAdmin, claimedByMe, staleClaim } = props;

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [evidenceUrl, setEvidenceUrl] = useState<string | null>(null);

  // Confirm form state
  const [checks, setChecks] = useState<boolean[]>(() => CHECKLIST.map(() => false));
  const [confirmedReference, setConfirmedReference] = useState("");
  const [confirmedAmount, setConfirmedAmount] = useState(props.balance ?? props.expectedAmount ?? "");
  const [settlementDate, setSettlementDate] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");
  const [override, setOverride] = useState(false);

  // Reject form state
  const [rejectionCode, setRejectionCode] = useState<RejectionCode | "">("");
  const [merchantMessage, setMerchantMessage] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [mode, setMode] = useState<"none" | "confirm" | "reject">("none");

  const confirmReady = useMemo(() => {
    return (
      checks.every(Boolean) &&
      confirmedReference.trim().length > 0 &&
      normalizeDecimalString(confirmedAmount) !== null &&
      settlementDate.trim().length > 0 &&
      evidenceNote.trim().length > 0
    );
  }, [checks, confirmedReference, confirmedAmount, settlementDate, evidenceNote]);

  async function call(path: string, body: Record<string, unknown>, label: string) {
    setBusy(label);
    setError(null);
    try {
      const res = await fetch(`/api/admin/subscription-payments/${attemptId}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `${label} failed`);
        return null;
      }
      router.refresh();
      return data;
    } catch {
      setError("Network error");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function loadEvidence() {
    setBusy("evidence");
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/subscription-payments/${attemptId}/evidence-url`,
        { method: "POST" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not open evidence");
        return;
      }
      setEvidenceUrl(data.url);
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch {
      setError("Network error");
    } finally {
      setBusy(null);
    }
  }

  if (!canDecide) {
    return (
      <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">
        You have read-only finance access. A finance admin or super admin must action this review.
      </p>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      {error && <p className="text-sm text-red-600">{error}</p>}

      {props.hasEvidence && (
        <Button size="sm" variant="outline" onClick={loadEvidence} disabled={busy === "evidence"}>
          {busy === "evidence" ? "Signing…" : evidenceUrl ? "Re-open evidence" : "Open evidence"}
        </Button>
      )}

      {/* Claim / takeover */}
      {status === "submitted" && (
        <Button
          size="sm"
          onClick={() => call("start-review", { expectedVersion: version }, "start")}
          disabled={busy === "start"}
        >
          {busy === "start" ? "Claiming…" : "Start review"}
        </Button>
      )}

      {status === "under_review" && !claimedByMe && (
        <div className="rounded bg-white p-2 text-sm">
          <p className="text-slate-600">
            Claimed by {props.claimedByName ?? "another reviewer"}.
            {staleClaim ? " Claim is stale and can be taken over." : " Open read-only until released."}
          </p>
          {staleClaim && (
            <TakeOverForm
              onSubmit={(reason) =>
                call("take-over", { reason, expectedVersion: version }, "takeover")
              }
              busy={busy === "takeover"}
            />
          )}
        </div>
      )}

      {/* Decision actions — only when claimed by me */}
      {status === "under_review" && claimedByMe && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={mode === "confirm" ? "default" : "outline"}
              onClick={() => setMode("confirm")}
            >
              Confirm payment
            </Button>
            <Button
              size="sm"
              variant={mode === "reject" ? "destructive" : "outline"}
              onClick={() => setMode("reject")}
            >
              Reject attempt
            </Button>
          </div>

          {mode === "confirm" && (
            <div className="space-y-2 rounded-lg bg-white p-3">
              <p className="text-xs font-semibold uppercase text-slate-400">
                Reconciliation checklist
              </p>
              {CHECKLIST.map((item, i) => (
                <label key={i} className="flex items-start gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={checks[i]}
                    onChange={(e) =>
                      setChecks((c) => c.map((v, idx) => (idx === i ? e.target.checked : v)))
                    }
                    className="mt-0.5"
                  />
                  {item}
                </label>
              ))}

              <div className="grid gap-2 pt-2 md:grid-cols-2">
                <Input
                  placeholder="Confirmed provider reference"
                  value={confirmedReference}
                  onChange={(e) => setConfirmedReference(e.target.value)}
                />
                <Input
                  placeholder="Confirmed amount (KES, e.g. 24000.00)"
                  value={confirmedAmount}
                  onChange={(e) => setConfirmedAmount(e.target.value)}
                  className="font-mono"
                />
                <Input
                  type="datetime-local"
                  value={settlementDate}
                  onChange={(e) => setSettlementDate(e.target.value)}
                />
                <Input value="KES" disabled className="font-mono" />
              </div>
              <textarea
                placeholder="Internal evidence note (required)"
                value={evidenceNote}
                onChange={(e) => setEvidenceNote(e.target.value)}
                className="min-h-[64px] w-full rounded-lg border border-slate-200 p-2 text-sm"
              />
              {isSuperAdmin && (
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={override}
                    onChange={(e) => setOverride(e.target.checked)}
                  />
                  Record a super-admin override (claim/state checks)
                </label>
              )}
              <Button
                size="sm"
                disabled={!confirmReady || busy === "confirm"}
                onClick={() => {
                  const amount = normalizeDecimalString(confirmedAmount);
                  call(
                    "confirm",
                    {
                      expectedVersion: version,
                      confirmedReference: confirmedReference.trim(),
                      confirmedAmount: amount,
                      confirmedCurrency: "KES",
                      paymentDate: new Date(settlementDate).toISOString(),
                      evidenceNote: evidenceNote.trim(),
                      superAdminOverride: override,
                    },
                    "confirm",
                  );
                }}
              >
                {busy === "confirm" ? "Confirming…" : "Confirm payment"}
              </Button>
              {!confirmReady && (
                <p className="text-xs text-slate-400">
                  Complete every checklist item and required field to enable confirmation.
                </p>
              )}
            </div>
          )}

          {mode === "reject" && (
            <div className="space-y-2 rounded-lg bg-white p-3">
              <select
                value={rejectionCode}
                onChange={(e) => setRejectionCode(e.target.value as RejectionCode)}
                className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm"
              >
                <option value="">Select a rejection code…</option>
                {REJECTION_CODES.map((code) => (
                  <option key={code} value={code}>
                    {REJECTION_CODE_LABELS[code]}
                  </option>
                ))}
              </select>
              <textarea
                placeholder="Merchant-safe message (shown to the merchant)"
                value={merchantMessage}
                onChange={(e) => setMerchantMessage(e.target.value)}
                className="min-h-[56px] w-full rounded-lg border border-slate-200 p-2 text-sm"
                maxLength={500}
              />
              <textarea
                placeholder="Internal note"
                value={internalNote}
                onChange={(e) => setInternalNote(e.target.value)}
                className="min-h-[56px] w-full rounded-lg border border-slate-200 p-2 text-sm"
                maxLength={2000}
              />
              <Button
                size="sm"
                variant="destructive"
                disabled={
                  !rejectionCode ||
                  merchantMessage.trim().length === 0 ||
                  (rejectionCode === "other" && internalNote.trim().length === 0) ||
                  busy === "reject"
                }
                onClick={() =>
                  call(
                    "reject",
                    {
                      expectedVersion: version,
                      rejectionCode,
                      merchantMessage: merchantMessage.trim(),
                      internalNote: internalNote.trim() || null,
                    },
                    "reject",
                  )
                }
              >
                {busy === "reject" ? "Rejecting…" : "Reject attempt"}
              </Button>
            </div>
          )}
        </div>
      )}

      {(status === "confirmed" || status === "rejected") && (
        <p className="text-sm text-slate-500">This attempt is {status}. The decision is immutable.</p>
      )}
    </div>
  );
}

function TakeOverForm({
  onSubmit,
  busy,
}: {
  onSubmit: (reason: string) => void;
  busy: boolean;
}) {
  const [reason, setReason] = useState("");
  return (
    <div className="mt-2 flex gap-2">
      <Input
        placeholder="Takeover reason (required)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <Button size="sm" disabled={!reason.trim() || busy} onClick={() => onSubmit(reason.trim())}>
        {busy ? "Taking over…" : "Take over"}
      </Button>
    </div>
  );
}
