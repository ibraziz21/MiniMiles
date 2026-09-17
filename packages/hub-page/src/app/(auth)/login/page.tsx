"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/Logo";

type Mode = "otp" | "password";
type OtpStep = "email" | "verify";

function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/me";
  return value;
}

const CALLBACK_ERROR_MESSAGE: Record<string, string> = {
  auth_failed: "That sign-in link expired or was already used. Please request a new one below.",
};

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams.get("next"));
  const emailId = useId();
  const otpId = useId();
  const passwordId = useId();

  const [mode, setMode] = useState<Mode>("otp");
  const [otpStep, setOtpStep] = useState<OtpStep>("email");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  // auth/callback redirects here with ?error=auth_failed on a failed
  // magic-link/OAuth exchange — previously never read, so the user just
  // landed on a blank form with no explanation of what went wrong.
  useEffect(() => {
    const callbackError = searchParams.get("error");
    if (callbackError && CALLBACK_ERROR_MESSAGE[callbackError]) {
      setError(CALLBACK_ERROR_MESSAGE[callbackError]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const supabase = createClient();

  async function sendOtp() {
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
      },
    });
    setLoading(false);
    if (error) return setError(error.message);
    setSent(true);
    setOtpStep("verify");
  }

  async function afterSignIn() {
    // Fire-and-forget: import wallet from users table if email matches
    fetch("/api/auth/sync-wallets", { method: "POST" }).catch(() => null);
    router.push(next);
    router.refresh();
  }

  async function verifyOtp() {
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: otp,
      type: "email",
    });
    setLoading(false);
    if (error) return setError(error.message);
    await afterSignIn();
  }

  async function signInWithPassword() {
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return setError(error.message);
    await afterSignIn();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    if (mode === "otp" && otpStep === "email") void sendOtp();
    else if (mode === "otp" && otpStep === "verify") void verifyOtp();
    else if (mode === "password") void signInWithPassword();
  }

  return (
    <div className="flex min-h-[calc(100vh-64px)] items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>

        <div className="rounded-2xl border border-akiba-line bg-white p-8 shadow-soft">
          <h1 className="font-sterling text-2xl font-semibold text-akiba-ink">
            Sign in to Akiba Pass
          </h1>
          <p className="mt-1 text-sm text-akiba-muted">
            Earn miles, redeem vouchers, and track your rewards.
          </p>

          {/* Mode toggle */}
          <div className="mt-6 flex rounded-xl border border-akiba-line p-1" role="tablist" aria-label="Sign-in method">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "otp"}
              onClick={() => { setMode("otp"); setError(null); }}
              className={`flex-1 rounded-lg py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal ${
                mode === "otp"
                  ? "bg-akiba-teal text-white"
                  : "text-akiba-muted hover:text-akiba-ink"
              }`}
            >
              Email code
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "password"}
              onClick={() => { setMode("password"); setError(null); }}
              className={`flex-1 rounded-lg py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal ${
                mode === "password"
                  ? "bg-akiba-teal text-white"
                  : "text-akiba-muted hover:text-akiba-ink"
              }`}
            >
              Password
            </button>
          </div>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {/* Email field — always shown */}
            <div>
              <label htmlFor={emailId} className="mb-1.5 block text-sm font-medium text-akiba-ink">
                Email address
              </label>
              <input
                id={emailId}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                disabled={mode === "otp" && otpStep === "verify"}
                autoComplete="email"
                spellCheck={false}
                className="w-full rounded-xl border border-akiba-line bg-akiba-card px-4 py-2.5 text-sm text-akiba-ink placeholder:text-akiba-muted/50 focus:border-akiba-teal focus:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal disabled:opacity-50"
              />
            </div>

            {/* OTP verify step */}
            {mode === "otp" && otpStep === "verify" && (
              <div>
                <label htmlFor={otpId} className="mb-1.5 block text-sm font-medium text-akiba-ink">
                  6-digit code
                </label>
                <input
                  id={otpId}
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                  placeholder="123456"
                  autoComplete="one-time-code"
                  className="w-full rounded-xl border border-akiba-line bg-akiba-card px-4 py-2.5 text-center font-mono text-lg tracking-[0.4em] text-akiba-ink placeholder:text-akiba-muted/40 focus:border-akiba-teal focus:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
                />
                <p className="mt-2 text-xs text-akiba-muted">
                  We sent a 6-digit code to <strong>{email}</strong>. Enter it
                  here to sign in.{" "}
                  <button
                    type="button"
                    onClick={() => { setOtpStep("email"); setSent(false); setOtp(""); }}
                    className="text-akiba-teal underline-offset-2 hover:underline"
                  >
                    Change email
                  </button>
                </p>
              </div>
            )}

            {/* Password field */}
            {mode === "password" && (
              <div>
                <label htmlFor={passwordId} className="mb-1.5 block text-sm font-medium text-akiba-ink">
                  Password
                </label>
                <input
                  id={passwordId}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="w-full rounded-xl border border-akiba-line bg-akiba-card px-4 py-2.5 text-sm text-akiba-ink placeholder:text-akiba-muted/50 focus:border-akiba-teal focus:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
                />
              </div>
            )}

            {error && (
              <p role="alert" className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">
                {error}
              </p>
            )}

            {/* CTA */}
            {mode === "otp" && otpStep === "email" && (
              <button
                type="submit"
                disabled={loading || !email}
                className="w-full rounded-xl bg-akiba-teal py-3 text-sm font-semibold text-white transition hover:bg-akiba-tealDark disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal focus-visible:ring-offset-2"
              >
                {loading ? "Sending…" : sent ? "Resend code" : "Send code"}
              </button>
            )}

            {mode === "otp" && otpStep === "verify" && (
              <button
                type="submit"
                disabled={loading || otp.length !== 6}
                className="w-full rounded-xl bg-akiba-teal py-3 text-sm font-semibold text-white transition hover:bg-akiba-tealDark disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal focus-visible:ring-offset-2"
              >
                {loading ? "Verifying…" : "Confirm & sign in"}
              </button>
            )}

            {mode === "password" && (
              <button
                type="submit"
                disabled={loading || !email || !password}
                className="w-full rounded-xl bg-akiba-teal py-3 text-sm font-semibold text-white transition hover:bg-akiba-tealDark disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal focus-visible:ring-offset-2"
              >
                {loading ? "Signing in…" : "Sign in"}
              </button>
            )}
          </form>

          <p className="mt-6 text-center text-xs text-akiba-muted">
            New here? Just enter your email &mdash; we&apos;ll create your account automatically.
          </p>
        </div>
      </div>
    </div>
  );
}
