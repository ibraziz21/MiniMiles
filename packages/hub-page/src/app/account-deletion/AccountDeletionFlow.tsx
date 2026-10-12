"use client";

// Client half of the public deletion page (AKIBA-MOB-002 §6). Calls the same
// /api/v1/me/account-deletion* routes as the native app — cookie-authenticated
// here, Bearer there — so there is one verification path and one record.
//
// Note on step order: §5.3/§5.4 describe "verify the code, then show a final
// review", but §7.3's contract takes `challengeId`, `otp` and
// `acknowledgement` in a single call — there is no standalone verify
// endpoint, deliberately, because a separate one would be a second place to
// get OTP handling wrong. So the code is collected, the review is shown, and
// both are submitted together; an invalid code returns the member to the code
// step with their context intact, which is what §5.6 asks for.
import { useCallback, useState } from "react";

type Step = "start" | "code" | "review" | "done";

type Summary = {
  maskedEmail: string;
  milesBalance: number;
  activeVoucherCount: number;
  linkedWalletCount: number;
  acceptingRequests: boolean;
};

type Receipt = {
  requestId: string;
  status: string;
  targetCompletionAt: string;
  alreadyRequested: boolean;
};

type Props = {
  signedIn: boolean;
  maskedEmail: string | null;
  policyVersion: string;
  processingTargetDays: number;
  supportEmail: string;
};

const GENERIC_ERROR = "Something went wrong. Please try again.";

async function readError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as
    | { error?: { message?: string } }
    | null;
  return body?.error?.message ?? GENERIC_ERROR;
}

export function AccountDeletionFlow({
  signedIn,
  maskedEmail,
  policyVersion,
  processingTargetDays,
  supportEmail,
}: Props) {
  const [step, setStep] = useState<Step>("start");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // Summary first: the member must see the real effects before a code is
      // sent, and these numbers are never carried over from another page.
      const summaryResponse = await fetch("/api/v1/me/account-deletion-summary", {
        headers: { Accept: "application/json" },
      });
      if (!summaryResponse.ok) {
        setError(await readError(summaryResponse));
        return;
      }
      const summaryBody = (await summaryResponse.json()) as { data: Summary };
      setSummary(summaryBody.data);

      if (!summaryBody.data.acceptingRequests) {
        // Stop before sending a code the request API would refuse — the
        // member would otherwise be walked up to a locked door.
        setError(
          `Account deletion isn't available on this page just yet. Email ${supportEmail} and we'll delete your account for you.`,
        );
        return;
      }

      const challengeResponse = await fetch("/api/v1/me/account-deletion/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: "{}",
      });
      if (!challengeResponse.ok) {
        setError(await readError(challengeResponse));
        return;
      }
      const challengeBody = (await challengeResponse.json()) as {
        data: { challengeId: string };
      };
      setChallengeId(challengeBody.data.challengeId);
      setStep("code");
    } catch {
      setError("We couldn't reach Akiba. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }, [supportEmail]);

  const submit = useCallback(async () => {
    if (!challengeId || !acknowledged || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/me/account-deletion-request", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ challengeId, otp: code, acknowledgement: true, policyVersion }),
      });

      if (!response.ok) {
        setError(await readError(response));
        // A bad code sends the member back to the code field with the rest of
        // their context kept (§5.6), rather than restarting the flow.
        if (response.status === 400 || response.status === 403) setStep("code");
        return;
      }

      const receiptBody = (await response.json()) as { data: Receipt };
      setReceipt(receiptBody.data);
      setStep("done");
    } catch {
      // The request may have been accepted and the response lost. Submission
      // is idempotent, so retrying returns the original receipt.
      setError("We couldn't confirm your request. Try again — you won't create a second request.");
    } finally {
      setBusy(false);
    }
  }, [acknowledged, busy, challengeId, code, policyVersion]);

  if (!signedIn) {
    return (
      <div className="rounded-3xl border border-akiba-line bg-white p-6 shadow-chip">
        <h2 className="font-sterling text-2xl font-medium text-akiba-ink">Start deletion request</h2>
        <p className="mt-2 text-base leading-7 text-akiba-muted">
          Sign in to the account you want to delete. We verify it with a code sent to your account email
          before accepting the request.
        </p>
        <a
          className="mt-5 inline-flex min-h-[48px] items-center justify-center rounded-full bg-akiba-tealDark px-6 text-base font-semibold text-white"
          href="/login?next=/account-deletion">
          Start deletion request
        </a>
        <p className="mt-4 text-sm leading-6 text-akiba-muted">
          No access to your account email? Contact{" "}
          <a className="font-medium text-akiba-tealDark underline" href={`mailto:${supportEmail}`}>
            {supportEmail}
          </a>
          .
        </p>
      </div>
    );
  }

  if (step === "done" && receipt) {
    return (
      <div className="rounded-3xl border border-akiba-line bg-white p-6 shadow-chip" role="status">
        <h2 className="font-sterling text-2xl font-medium text-akiba-ink">
          {receipt.alreadyRequested ? "Your request is already in progress" : "Deletion request received"}
        </h2>
        <p className="mt-2 text-base leading-7 text-akiba-muted">
          We will complete processing by{" "}
          {new Date(receipt.targetCompletionAt).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
          , and email your account address when it is done.
        </p>
        <p className="mt-4 text-sm text-akiba-muted">Your reference</p>
        <p className="font-mono text-base text-akiba-ink">{receipt.requestId}</p>
        <p className="mt-4 text-sm leading-6 text-akiba-muted">
          Keep this reference if you need to contact{" "}
          <a className="font-medium text-akiba-tealDark underline" href={`mailto:${supportEmail}`}>
            {supportEmail}
          </a>{" "}
          about the request.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-akiba-line bg-white p-6 shadow-chip">
      <h2 className="font-sterling text-2xl font-medium text-akiba-ink">Start deletion request</h2>

      {step === "start" ? (
        <>
          <p className="mt-2 text-base leading-7 text-akiba-muted">
            We will send a 6-digit code to {maskedEmail ?? "your account email"} to confirm this is your
            account. Nothing is deleted until you confirm.
          </p>
          <button
            className="mt-5 min-h-[48px] rounded-full bg-akiba-tealDark px-6 text-base font-semibold text-white disabled:opacity-50"
            disabled={busy}
            onClick={() => void start()}
            type="button">
            {busy ? "Sending code…" : "Send verification code"}
          </button>
        </>
      ) : null}

      {step === "code" ? (
        <>
          <p className="mt-2 text-base leading-7 text-akiba-muted">
            Enter the 6-digit code we sent to {summary?.maskedEmail ?? maskedEmail}.
          </p>
          <label className="mt-5 block text-sm font-semibold text-akiba-ink" htmlFor="deletion-code">
            Verification code
          </label>
          <input
            autoComplete="one-time-code"
            className="mt-1 min-h-[48px] w-full max-w-[14rem] rounded-xl border border-akiba-line px-4 text-center text-2xl tracking-[0.5em] text-akiba-ink"
            id="deletion-code"
            inputMode="numeric"
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            value={code}
          />
          <button
            className="mt-5 block min-h-[48px] rounded-full bg-akiba-tealDark px-6 text-base font-semibold text-white disabled:opacity-50"
            disabled={code.length !== 6 || busy}
            onClick={() => setStep("review")}
            type="button">
            Continue
          </button>
        </>
      ) : null}

      {step === "review" ? (
        <>
          <p className="mt-2 text-base leading-7 text-akiba-muted">
            This is the last step. Processing takes up to {processingTargetDays} days and cannot be
            undone.
          </p>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-base leading-7 text-akiba-muted">
            <li>
              AkibaMiles balance lost: <strong className="text-akiba-ink">{summary?.milesBalance ?? 0}</strong>
            </li>
            <li>
              Active vouchers that stop working:{" "}
              <strong className="text-akiba-ink">{summary?.activeVoucherCount ?? 0}</strong>
            </li>
            <li>
              Linked wallet associations removed:{" "}
              <strong className="text-akiba-ink">{summary?.linkedWalletCount ?? 0}</strong>
            </li>
          </ul>

          <label className="mt-5 flex items-start gap-3 text-base leading-7 text-akiba-ink">
            <input
              checked={acknowledged}
              className="mt-1.5 h-5 w-5"
              onChange={(event) => setAcknowledged(event.target.checked)}
              type="checkbox"
            />
            <span>
              I understand that I will lose access to my Akiba Pass, active vouchers, and account-based
              rewards.
            </span>
          </label>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              className="min-h-[48px] rounded-full bg-red-600 px-6 text-base font-semibold text-white disabled:opacity-50"
              disabled={!acknowledged || busy}
              onClick={() => void submit()}
              type="button">
              {busy ? "Submitting…" : "Delete my Akiba account"}
            </button>
            <button
              className="min-h-[48px] rounded-full border border-akiba-line px-6 text-base font-semibold text-akiba-ink"
              onClick={() => setStep("code")}
              type="button">
              Back
            </button>
          </div>
        </>
      ) : null}

      {error ? (
        <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm leading-6 text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
