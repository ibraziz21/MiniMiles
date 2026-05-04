"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ADMIN_ROLE_LABELS, ADMIN_ROLES, type AdminRole } from "@/types";

export function InviteAdminForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<AdminRole>("readonly");
  const [setupUrl, setSetupUrl] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    setSetupUrl("");
    setLoading(true);

    try {
      const res = await fetch("/api/admin/team/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, role }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Failed to invite admin");
        return;
      }

      setEmail("");
      setName("");
      setRole("readonly");
      setSetupUrl(data.setupUrl);
      setMessage("Setup link created. Share it directly with the team member.");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function copyLink() {
    if (!setupUrl) return;
    await navigator.clipboard.writeText(setupUrl);
    setMessage("Setup link copied.");
  }

  return (
    <form onSubmit={handleSubmit} className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
      <div className="grid gap-3 lg:grid-cols-[1fr_1fr_220px_auto]">
        <Input
          type="email"
          placeholder="teammate@akibamiles.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Input
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Select value={role} onValueChange={(value) => setRole(value as AdminRole)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ADMIN_ROLES.map((adminRole) => (
              <SelectItem key={adminRole} value={adminRole}>
                {ADMIN_ROLE_LABELS[adminRole]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" disabled={loading}>
          {loading ? "Creating..." : "Create access"}
        </Button>
      </div>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
      {message && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p>}

      {setupUrl && (
        <div className="mt-3 flex gap-2">
          <Input value={setupUrl} readOnly />
          <Button type="button" variant="outline" onClick={copyLink}>
            Copy
          </Button>
        </div>
      )}
    </form>
  );
}
