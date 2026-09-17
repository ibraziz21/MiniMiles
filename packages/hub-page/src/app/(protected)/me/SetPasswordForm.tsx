"use client";

import { useId, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { Lock, CheckCircle2, Loader2 } from "lucide-react";

/**
 * Lets an OTP/magic-link user set (or change) an account password.
 * With a password set, the same account can sign in faster here — and can
 * access the Merchant Dashboard if it has (or later gains) merchant access.
 */
export function SetPasswordForm() {
  const supabase = createClient();
  const passwordId = useId();
  const confirmId = useId();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setSaving(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    setDone(true);
    setPassword("");
    setConfirm("");
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-akiba-line bg-white px-6 py-8 text-center">
        <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-emerald-500" />
        <p className="text-sm font-medium text-akiba-ink">Password set</p>
        <p className="mt-1 text-xs text-akiba-muted">
          You can now sign in with your email and password — here, and on the
          Merchant Dashboard if your account has merchant access.
        </p>
        <button
          onClick={() => setDone(false)}
          className="mt-4 text-xs font-semibold text-akiba-teal"
        >
          Change it again
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-akiba-line bg-white p-5">
      <p className="flex items-center gap-2 text-sm font-semibold text-akiba-ink">
        <Lock className="h-4 w-4 text-akiba-teal" /> Account password
      </p>
      <p className="mt-1 text-xs text-akiba-muted">
        Optional — sign in without waiting for an email code. Also required to
        access the Merchant Dashboard if you run a business on Akiba.
      </p>

      <form onSubmit={save} className="mt-4 space-y-3">
        <div>
          <label htmlFor={passwordId} className="sr-only">New password</label>
          <input
            id={passwordId}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="New password (min 8 characters)"
            autoComplete="new-password"
            className="w-full rounded-xl border border-akiba-line bg-akiba-card px-4 py-2.5 text-sm text-akiba-ink placeholder:text-akiba-muted/50 focus:border-akiba-teal focus:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
          />
        </div>
        <div>
          <label htmlFor={confirmId} className="sr-only">Confirm password</label>
          <input
            id={confirmId}
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm password"
            autoComplete="new-password"
            className="w-full rounded-xl border border-akiba-line bg-akiba-card px-4 py-2.5 text-sm text-akiba-ink placeholder:text-akiba-muted/50 focus:border-akiba-teal focus:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
          />
        </div>

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
        )}

        <button
          type="submit"
          disabled={saving || !password || !confirm}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-akiba-teal py-2.5 text-sm font-semibold text-white transition hover:bg-akiba-tealDark disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
        >
          {saving ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
          ) : (
            "Set password"
          )}
        </button>
      </form>
    </div>
  );
}
