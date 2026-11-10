"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

interface AddMerchantNoteProps {
  merchantId: string;
}

export function AddMerchantNote({ merchantId }: AddMerchantNoteProps) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    const trimmed = note.trim();
    if (!trimmed) return;
    setError("");
    setSaved(false);
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/merchants/${merchantId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to add note");
        return;
      }
      setNote("");
      setSaved(true);
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <label
        className="block text-sm font-medium"
        htmlFor="merchant-internal-note"
      >
        Internal note (staff only)
      </label>
      <textarea
        id="merchant-internal-note"
        disabled={loading}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Add an internal operations note..."
        className="min-h-20 w-full rounded-card border border-border bg-surface px-3 py-2 text-base outline-none transition-colors placeholder:text-ink-muted focus:border-primary focus:ring-2 focus:ring-primary/10"
      />
      {saved && (
        <p role="status" className="text-sm text-primary-strong">
          Note saved
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button onClick={submit} disabled={loading || !note.trim()} size="sm">
          {loading ? "Adding..." : "Save note"}
        </Button>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
