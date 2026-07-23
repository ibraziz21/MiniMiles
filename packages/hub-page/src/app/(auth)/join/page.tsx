"use client";

// In-store fast path — home-redesign-spec.md §6. Poster QRs point here with
// a per-poster/location src for attribution. One screen: signup only, no
// marketing scroll. Counter-time beats education — after signup this skips
// straight to the QR reveal; /welcome is offered on the next visit instead.
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/Logo";
import { track } from "@/lib/analytics/track";
import { JoinQrReveal } from "./JoinQrReveal";

type Step = "email" | "verify" | "reveal";

export default function JoinPage() {
  const searchParams = useSearchParams();
  const src = searchParams.get("src") ?? "unknown";

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passId, setPassId] = useState<string | null>(null);
  const [startedAt] = useState(() => Date.now());

  const supabase = createClient();

  useEffect(() => { track("join_view", { src }); }, [src]);

  async function sendOtp() {
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    setLoading(false);
    if (error) return setError(error.message);
    setStep("verify");
  }

  async function verifyOtp() {
    setLoading(true);
    setError(null);
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token: otp,
      type: "email",
    });
    if (verifyError) {
      setLoading(false);
      setError(verifyError.message);
      return;
    }

    try {
      const res = await fetch("/api/auth/join-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ src }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");

      track("join_completed", {
        src,
        seconds_to_complete: Math.round((Date.now() - startedAt) / 1000),
      });
      setPassId(data.publicPassId);
      setStep("reveal");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (step === "reveal" && passId) {
    return <JoinQrReveal passId={passId} />;
  }

  return (
    <div className="flex min-h-[calc(100vh-64px)] items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>

        <div className="rounded-2xl border border-akiba-line bg-white p-8 shadow-soft">
          <h1 className="font-sterling text-2xl font-semibold text-akiba-ink">
            Sign up in 1 minute
          </h1>
          <p className="mt-1 text-sm text-akiba-muted">
            Earn points on this purchase.
          </p>

          <div className="mt-6 space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-akiba-ink">
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                disabled={step === "verify"}
                className="w-full rounded-xl border border-akiba-line bg-akiba-card px-4 py-2.5 text-sm text-akiba-ink placeholder:text-akiba-muted/50 focus:border-akiba-teal focus:outline-none focus:ring-2 focus:ring-akiba-teal/20 disabled:opacity-50"
              />
            </div>

            {step === "verify" && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-akiba-ink">
                  6-digit code
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                  placeholder="123456"
                  className="w-full rounded-xl border border-akiba-line bg-akiba-card px-4 py-2.5 text-center font-mono text-lg tracking-[0.4em] text-akiba-ink placeholder:text-akiba-muted/40 focus:border-akiba-teal focus:outline-none focus:ring-2 focus:ring-akiba-teal/20"
                />
                <p className="mt-2 text-xs text-akiba-muted">
                  We sent a 6-digit code to <strong>{email}</strong>.
                </p>
              </div>
            )}

            {error && (
              <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>
            )}

            {step === "email" ? (
              <button
                onClick={sendOtp}
                disabled={loading || !email}
                className="w-full rounded-xl bg-akiba-teal py-3 text-sm font-semibold text-white transition hover:bg-[#1E7E8D] disabled:opacity-50"
              >
                {loading ? "Sending…" : "Send code"}
              </button>
            ) : (
              <button
                onClick={verifyOtp}
                disabled={loading || otp.length !== 6}
                className="w-full rounded-xl bg-akiba-teal py-3 text-sm font-semibold text-white transition hover:bg-[#1E7E8D] disabled:opacity-50"
              >
                {loading ? "Verifying…" : "Confirm & earn"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
