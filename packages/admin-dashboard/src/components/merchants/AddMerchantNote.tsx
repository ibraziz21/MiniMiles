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
  const [error, setError] = useState("");

  async function submit() {
    const trimmed = note.trim();
    if (!trimmed) return;
    setError("");
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
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Add an internal operations note..."
        className="min-h-20 w-full rounded-card border border-border bg-surface px-3 py-2 text-sm outline-none transition-colors placeholder:text-ink-muted focus:border-primary focus:ring-2 focus:ring-primary/10"
      />
      <div className="flex items-center gap-3">
        <Button onClick={submit} disabled={loading || !note.trim()} size="sm">
          {loading ? "Adding..." : "Add Note"}
        </Button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
