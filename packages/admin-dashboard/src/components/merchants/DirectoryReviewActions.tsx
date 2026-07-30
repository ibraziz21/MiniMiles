"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DIRECTORY_SECTIONS,
  type DirectoryModerationAction,
  type DirectorySectionKey,
  type DirectoryStatus,
} from "@/lib/merchant-directory-review";

const ACTION_COPY: Record<DirectoryModerationAction, { label: string; pending: string }> = {
  publish: { label: "Approve & publish", pending: "Publishing..." },
  request_changes: { label: "Request changes", pending: "Sending..." },
  suspend: { label: "Suspend profile", pending: "Suspending..." },
  restore: { label: "Restore to paused", pending: "Restoring..." },
};

function actionsForStatus(status: DirectoryStatus): DirectoryModerationAction[] {
  if (status === "pending_review") return ["publish", "request_changes", "suspend"];
  if (status === "published" || status === "paused") return ["suspend"];
  if (status === "suspended") return ["restore"];
  return [];
}

export function DirectoryReviewActions({
  merchantId,
  status,
}: {
  merchantId: string;
  status: DirectoryStatus;
}) {
  const router = useRouter();
  const actions = actionsForStatus(status);
  const [affectedSections, setAffectedSections] = useState<DirectorySectionKey[]>([]);
  const [merchantSafeMessage, setMerchantSafeMessage] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [loading, setLoading] = useState<DirectoryModerationAction | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  if (actions.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No reviewer action is available while this profile is {status.replaceAll("_", " ")}.
      </p>
    );
  }

  function toggleSection(section: DirectorySectionKey) {
    setAffectedSections((current) =>
      current.includes(section)
        ? current.filter((value) => value !== section)
        : [...current, section],
    );
  }

  async function runAction(action: DirectoryModerationAction) {
    setError("");
    setSuccess("");

    if ((action === "request_changes" || action === "suspend") && !merchantSafeMessage.trim()) {
      setError("Add a merchant-visible message before taking this action.");
      return;
    }

    setLoading(action);
    try {
      const response = await fetch(`/api/admin/directory-reviews/${merchantId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          affectedSections,
          merchantSafeMessage: merchantSafeMessage.trim() || null,
          internalNote: internalNote.trim() || null,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "The profile could not be updated.");
        return;
      }

      setSuccess(`${ACTION_COPY[action].label} completed.`);
      setAffectedSections([]);
      setMerchantSafeMessage("");
      setInternalNote("");
      router.refresh();
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-5">
      {(actions.includes("request_changes") || actions.includes("suspend")) && (
        <>
          <fieldset>
            <legend className="text-sm font-medium text-slate-900">Affected sections</legend>
            <p className="mt-1 text-xs text-slate-500">
              Select the areas the merchant should revisit. These are visible in their dashboard.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {DIRECTORY_SECTIONS.map((section) => (
                <label
                  key={section.key}
                  className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                    affectedSections.includes(section.key)
                      ? "border-[#238D9D] bg-[#238D9D]/5 text-[#176B78]"
                      : "border-slate-200 text-slate-600"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={affectedSections.includes(section.key)}
                    onChange={() => toggleSection(section.key)}
                    className="accent-[#238D9D]"
                  />
                  {section.label}
                </label>
              ))}
            </div>
          </fieldset>

          <label className="block">
            <span className="text-sm font-medium text-slate-900">Message to merchant</span>
            <span className="ml-1 text-xs text-slate-500">(required for changes or suspension)</span>
            <textarea
              value={merchantSafeMessage}
              onChange={(event) => setMerchantSafeMessage(event.target.value)}
              maxLength={1000}
              rows={4}
              placeholder="Explain clearly what needs attention. Do not include internal risk or investigation details."
              className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#238D9D]"
            />
            <span className="mt-1 block text-right text-xs text-slate-400">
              {merchantSafeMessage.length}/1000
            </span>
          </label>
        </>
      )}

      <label className="block">
        <span className="text-sm font-medium text-slate-900">Internal review note</span>
        <span className="ml-1 text-xs text-slate-500">(never shown to the merchant)</span>
        <textarea
          value={internalNote}
          onChange={(event) => setInternalNote(event.target.value)}
          maxLength={2000}
          rows={3}
          placeholder="Record verification context or the reason for your decision."
          className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#238D9D]"
        />
      </label>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {success && <p className="text-sm text-emerald-600">{success}</p>}

      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <Button
            key={action}
            type="button"
            variant={
              action === "suspend"
                ? "destructive"
                : action === "request_changes" || action === "restore"
                  ? "outline"
                  : "default"
            }
            disabled={loading !== null}
            onClick={() => runAction(action)}
          >
            {loading === action ? ACTION_COPY[action].pending : ACTION_COPY[action].label}
          </Button>
        ))}
      </div>
    </div>
  );
}
