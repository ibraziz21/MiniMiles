"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DISCOVERY_PHOTO_REJECTION_REASONS } from "@/lib/discoveryModeration";

export function DiscoveryPhotoPreview({ photoId }: { photoId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/discovery-photos/${photoId}/preview-url`, { method: "POST" })
      .then((res) => res.json())
      .then((payload) => {
        if (!cancelled && payload?.url) setUrl(payload.url);
        else if (!cancelled) setError(true);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [photoId]);

  if (error) return <div className="flex h-32 w-32 items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-400">Unavailable</div>;
  if (!url) return <div className="flex h-32 w-32 items-center justify-center rounded-lg bg-slate-100 text-xs text-slate-400">Loading…</div>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="Submitted visit photo pending moderation" className="h-32 w-32 rounded-lg object-cover" />;
}

export function DiscoveryPhotoActions({ photoId }: { photoId: string }) {
  const router = useRouter();
  const [reasonCode, setReasonCode] = useState("");
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function runAction(action: "approve" | "reject") {
    setError("");
    if (action === "reject" && !reasonCode.trim()) {
      setError("A rejection reason is required.");
      return;
    }
    setLoading(action);
    try {
      const response = await fetch(`/api/admin/discovery-photos/${photoId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reasonCode: action === "reject" ? reasonCode.trim() : undefined }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "The photo could not be updated.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={loading !== null} onClick={() => runAction("approve")}>
          {loading === "approve" ? "Approving..." : "Approve"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={loading !== null}
          onClick={() => runAction("reject")}
        >
          {loading === "reject" ? "Rejecting..." : "Reject"}
        </Button>
      </div>
      <select
        value={reasonCode}
        onChange={(event) => setReasonCode(event.target.value)}
        aria-label="Rejection reason (required to reject)"
        className="h-8 w-64 rounded-lg border border-slate-200 px-2 text-xs text-slate-900"
      >
        <option value="">Rejection reason (required to reject)</option>
        {DISCOVERY_PHOTO_REJECTION_REASONS.map((reason) => (
          <option key={reason.value} value={reason.value}>
            {reason.label}
          </option>
        ))}
      </select>
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

/**
 * Emergency suppression for an already-approved (currently public) photo —
 * hardening spec §7.1/§8.3. Independent of approve/reject: it works on a
 * live photo and does not touch moderation_status.
 */
export function DiscoverySuppressionActions({ photoId, suppressed }: { photoId: string; suppressed: boolean }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function runAction() {
    setError("");
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/discovery-photos/${photoId}/suppress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suppressed: !suppressed, reasonCode: !suppressed ? reason.trim() || undefined : undefined }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "The photo could not be updated.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {!suppressed && (
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Suppression reason (optional, 64 chars max)"
          maxLength={64}
          className="h-8 w-64 rounded-lg border border-slate-200 px-2 text-xs text-slate-900 placeholder:text-slate-400"
        />
      )}
      <Button
        type="button"
        size="sm"
        variant={suppressed ? "default" : "destructive"}
        disabled={loading}
        onClick={runAction}
      >
        {loading ? "Saving..." : suppressed ? "Unsuppress" : "Suppress now"}
      </Button>
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
