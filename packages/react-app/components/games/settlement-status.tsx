export function SettlementStatus({ status }: { status: "idle" | "submitting" | "settled" | "rejected" | "error" }) {
  const copy =
    status === "submitting"
      ? "Verifier is checking your replay..."
      : status === "settled"
        ? "Verified. Settlement payload is ready for onchain payout."
        : status === "rejected"
          ? "Replay was rejected by anti-abuse checks."
          : status === "error"
            ? "Settlement failed. Try again."
            : "Waiting for replay submission.";
  return (
    <div className="rounded-xl border border-[#238D9D1F] bg-white p-3 text-sm">
      <p className="font-medium">Settlement</p>
      <p className="mt-1 text-[#525252]">{copy}</p>
    </div>
  );
}
