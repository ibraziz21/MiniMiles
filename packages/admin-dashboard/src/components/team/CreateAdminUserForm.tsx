"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { ADMIN_ROLES, ADMIN_ROLE_LABELS, type AdminRole } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CreateAdminUserForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AdminRole>("ops_admin");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setCreated(false);

    try {
      const res = await fetch("/api/admin/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, password, role }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create admin");
        return;
      }
      setEmail("");
      setName("");
      setPassword("");
      setRole("ops_admin");
      setCreated(true);
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <UserPlus className="h-4 w-4 text-[#238D9D]" />
        <p className="text-sm font-semibold text-slate-900">Add Admin User</p>
      </div>
      <div className="grid gap-3 md:grid-cols-5">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@akiba..." required />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as AdminRole)}
          className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900"
        >
          {ADMIN_ROLES.map((adminRole) => (
            <option key={adminRole} value={adminRole}>{ADMIN_ROLE_LABELS[adminRole]}</option>
          ))}
        </select>
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Temp password" required />
        <Button type="submit" disabled={loading}>{loading ? "Creating..." : "Create"}</Button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {created && <p className="mt-2 text-xs text-emerald-600">Admin user created.</p>}
    </form>
  );
}
