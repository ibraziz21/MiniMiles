"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ProfileSettingsFormProps {
  name: string | null;
  email: string;
  disabled?: boolean;
}

export function ProfileSettingsForm({ name, email, disabled = false }: ProfileSettingsFormProps) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(name ?? "");
  const [profileEmail, setProfileEmail] = useState(email);
  const [currentPassword, setCurrentPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const emailChanged = profileEmail.trim().toLowerCase() !== email.toLowerCase();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setLoading(true);

    try {
      const res = await fetch("/api/admin/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: displayName,
          email: profileEmail,
          currentPassword: emailChanged ? currentPassword : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to update profile");
        return;
      }
      setCurrentPassword("");
      setSuccess(true);
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-600">Name</span>
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            autoComplete="name"
            disabled={disabled || loading}
            placeholder="Admin name"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-600">Email</span>
          <Input
            type="email"
            value={profileEmail}
            onChange={(e) => setProfileEmail(e.target.value)}
            autoComplete="email"
            disabled={disabled || loading}
            required
          />
        </label>
      </div>

      {emailChanged && (
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
      )}

      <Button type="submit" disabled={disabled || loading}>
        <Save className="h-4 w-4" />
        {loading ? "Saving..." : "Save profile"}
      </Button>

      {disabled && <p className="text-xs text-amber-600">Profile changes are disabled in open-access mode.</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {success && <p className="text-xs text-emerald-600">Profile updated.</p>}
    </form>
  );
}
