"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AtSign, Loader2 } from "lucide-react";
import { SettingsRow } from "@/components/akiba/SettingsRow";
import { EditSheet } from "@/components/akiba/EditSheet";

// Public @username — now the user's permanent Akiba identity (used across
// the ecosystem, not just skill-game leaderboards). Optional — a missing
// username never blocks anything, it just means leaderboards and any future
// social surfaces show a neutral alias. Validation and the 30-day cooldown
// are enforced server-side by /api/me/username (set_leaderboard_username);
// this only reflects the server's response.

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export function UsernameEditor({ initialUsername }: { initialUsername: string | null }) {
  const router = useRouter();
  const inputId = useId();
  const [saved, setSaved] = useState(initialUsername);
  const [draft, setDraft] = useState(initialUsername ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalized = draft.trim().toLowerCase();
  const formatValid = USERNAME_RE.test(normalized);

  async function save(event: FormEvent<HTMLFormElement>, close: () => void) {
    event.preventDefault();
    if (!formatValid) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/me/username", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: normalized }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "Could not update username");
        return;
      }
      setSaved(body.username ?? normalized);
      close();
      router.refresh();
    } catch {
      setError("Could not update username");
    } finally {
      setSaving(false);
    }
  }

  return (
    <EditSheet
      title="Akiba username"
      trigger={(open) => (
        <SettingsRow
          icon={<AtSign className="h-4 w-4 text-akiba-teal" aria-hidden="true" />}
          label="Username"
          description={saved ? `@${saved}` : "Choose a username"}
          onClick={() => { setDraft(saved ?? ""); setError(null); open(); }}
        />
      )}
    >
      {(close) => (
        <form onSubmit={(e) => save(e, close)} className="space-y-3 pb-2">
          <p className="text-xs text-akiba-muted">
            Your identity across Akiba — including Rule Tap and Memory Flip
            leaderboards. 3-20 lowercase letters, numbers, or underscores.
          </p>
          <div>
            <label htmlFor={inputId} className="sr-only">Username</label>
            <div className="flex items-center gap-1.5 rounded-xl border border-akiba-line bg-white px-4 py-2.5 focus-within:border-akiba-teal focus-within:ring-2 focus-within:ring-akiba-teal">
              <span className="text-sm text-akiba-muted">@</span>
              <input
                id={inputId}
                value={draft}
                onChange={(e) => setDraft(e.target.value.toLowerCase())}
                placeholder="username"
                maxLength={20}
                className="min-w-0 flex-1 bg-transparent text-sm text-akiba-ink outline-none"
              />
            </div>
            {draft.length > 0 && !formatValid && (
              <p className="mt-1.5 text-xs text-red-500">3-20 lowercase letters, numbers, or underscores.</p>
            )}
          </div>
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
          )}
          <button
            type="submit"
            disabled={!formatValid || saving}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-akiba-teal py-2.5 text-sm font-semibold text-white transition hover:bg-akiba-tealDark disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
          >
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : "Save username"}
          </button>
        </form>
      )}
    </EditSheet>
  );
}
