"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

export function KillSwitchToggle({
  flagKey,
  label,
  description,
  initialEnabled,
  disabled,
}: {
  flagKey: string;
  label: string;
  description: string;
  initialEnabled: boolean;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    const next = !enabled;
    setLoading(true);
    setEnabled(next); // optimistic — this is an ops control, not a member-facing balance
    try {
      const res = await fetch(`/api/admin/referrals/flags/${flagKey}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) {
        setEnabled(!next);
      } else {
        router.refresh();
      }
    } catch {
      setEnabled(!next);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div>
        <p className="text-sm font-medium text-slate-900">{label}</p>
        <p className="text-xs text-slate-500">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={label}
        disabled={disabled || loading}
        onClick={toggle}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#238D9D] disabled:opacity-50",
          enabled ? "bg-[#238D9D]" : "bg-slate-300",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
            enabled ? "translate-x-[22px]" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}
