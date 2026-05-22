"use client";

import { FormEvent, useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface PasswordSettingsFormProps {
  email: string;
  disabled?: boolean;
}

export function PasswordSettingsForm({ email, disabled = false }: PasswordSettingsFormProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/admin/account/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to update password");
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess(true);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex items-start gap-3 rounded-lg border border-cyan-100 bg-cyan-50 p-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#238D9D]" />
        <div>
          <p className="text-sm font-semibold text-slate-900">{email}</p>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            Replace temporary credentials with a private password. Current sessions stay active.
          </p>
        </div>
      </div>

      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-slate-600">Current password</span>
        <Input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
          disabled={disabled || loading}
          required
        />
      </label>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-600">New password</span>
          <Input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            minLength={12}
            disabled={disabled || loading}
            required
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-600">Confirm new password</span>
          <Input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            minLength={12}
            disabled={disabled || loading}
            required
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={disabled || loading}>
          <KeyRound className="h-4 w-4" />
          {loading ? "Updating..." : "Update password"}
        </Button>
        <p className="text-xs text-slate-500">Minimum 12 characters.</p>
      </div>

      {disabled && (
        <p className="text-xs text-amber-600">Password changes are disabled in open-access mode.</p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {success && <p className="text-xs text-emerald-600">Password updated.</p>}
    </form>
  );
}
