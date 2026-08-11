"use client";

import { useState } from "react";
import { AtSign, Check, Loader2 } from "lucide-react";
import clsx from "clsx";

// Public @username claim/edit for skill-game leaderboards
// (skill-games-leaderboards-spec.md §5.3). Optional — a missing username
// never blocks play, it just means the leaderboard shows a neutral alias.
// Validation and the 30-day cooldown are enforced server-side by
// /api/me/username (set_leaderboard_username); this only reflects the
// server's response.

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export function UsernameEditor({ initialUsername }: { initialUsername: string | null }) {
  const [saved, setSaved] = useState(initialUsername);
  const [draft, setDraft] = useState(initialUsername ?? "");
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const normalized = draft.trim().toLowerCase();
  const formatValid = USERNAME_RE.test(normalized);

  async function save() {
    if (!formatValid) return;
    setStatus("saving");
    setError(null);
    try {
      const res = await fetch("/api/me/username", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: normalized }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus("error");
        setError(body?.error ?? "Could not update username");
        return;
      }
      setSaved(body.username ?? normalized);
      setStatus("saved");
      setEditing(false);
    } catch {
      setStatus("error");
      setError("Could not update username");
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => { setDraft(saved ?? ""); setEditing(true); setStatus("idle"); setError(null); }}
        className="flex items-center gap-2 rounded-full border border-akiba-line bg-akiba-card px-3 py-1 text-xs font-medium text-akiba-muted"
      >
        <AtSign className="h-3 w-3 shrink-0" />
        {saved ? `@${saved}` : "Set a leaderboard username"}
      </button>
    );
  }

  return (
    <div className="w-full max-w-xs rounded-xl border border-akiba-line bg-akiba-card px-3 py-2.5 text-xs">
      <p className="mb-1.5 flex items-center gap-1.5 font-medium text-akiba-muted">
        <AtSign className="h-3 w-3" /> Leaderboard username
      </p>
      <p className="mb-2 text-[11px] text-akiba-muted/80">
        Public on Rule Tap and Memory Flip leaderboards. 3-20 lowercase letters, numbers, or underscores.
      </p>
      <div className="flex items-center gap-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value.toLowerCase())}
          placeholder="username"
          maxLength={20}
          className="min-w-0 flex-1 rounded-lg border border-akiba-line bg-white px-2 py-1.5 text-xs text-akiba-ink outline-none focus:border-akiba-teal"
        />
        <button
          type="button"
          onClick={save}
          disabled={!formatValid || status === "saving"}
          className="flex items-center justify-center rounded-lg bg-akiba-teal px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
        >
          {status === "saving" ? <Loader2 className="h-3 w-3 animate-spin" /> : status === "saved" ? <Check className="h-3 w-3" /> : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="text-[11px] font-medium text-akiba-muted"
        >
          Cancel
        </button>
      </div>
      {draft.length > 0 && !formatValid && (
        <p className="mt-1.5 text-[11px] text-red-500">3-20 lowercase letters, numbers, or underscores.</p>
      )}
      {error && <p className={clsx("mt-1.5 text-[11px] text-red-500")}>{error}</p>}
    </div>
  );
}
