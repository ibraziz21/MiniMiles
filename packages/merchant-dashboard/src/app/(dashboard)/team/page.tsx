"use client";

import { useState, useEffect, FormEvent } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, X } from "lucide-react";
import type { MerchantUser } from "@/types";
import { formatDate } from "@/lib/utils";

export default function TeamPage() {
  const [members, setMembers] = useState<MerchantUser[]>([]);
  const [fetching, setFetching] = useState(true);
  const [isOwner, setIsOwner] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ email: "", name: "", role: "staff", password: "" });
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/merchant/team");
    const data = await res.json();
    if (data.members) setMembers(data.members);
  }

  useEffect(() => {
    Promise.all([
      load(),
      fetch("/api/auth/session").then((r) => r.json()).then((d) => {
        if (d.merchant?.role === "owner") setIsOwner(true);
      }),
    ]).finally(() => setFetching(false));
  }, []);

  async function handleToggleActive(member: MerchantUser) {
    await fetch(`/api/merchant/team/${member.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !member.is_active }),
    });
    await load();
  }

  async function handleRoleChange(member: MerchantUser, role: string) {
    await fetch(`/api/merchant/team/${member.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    await load();
  }

  async function handleAddMember(e: FormEvent) {
    e.preventDefault();
    setAddError(null);
    setAddLoading(true);
    try {
      const res = await fetch("/api/merchant/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(addForm),
      });
      const data = await res.json();
      if (!res.ok) { setAddError(data.error ?? "Failed to add member"); return; }
      setShowAdd(false);
      setAddForm({ email: "", name: "", role: "staff", password: "" });
      await load();
    } catch {
      setAddError("Network error");
    } finally {
      setAddLoading(false);
    }
  }

  const roleColor: Record<string, string> = {
    owner: "bg-purple-100 text-purple-700",
    manager: "bg-blue-100 text-blue-700",
    staff: "bg-gray-100 text-gray-700",
  };

  if (fetching) return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TopBar title="Team" subtitle="Manage team access" />
      <div className="flex-1 flex items-center justify-center text-sm text-gray-500">Loading…</div>
    </div>
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TopBar
        title="Team"
        subtitle={`${members.length} member${members.length !== 1 ? "s" : ""}`}
        actions={
          isOwner ? (
            <Button size="sm" className="gap-1.5" onClick={() => setShowAdd(!showAdd)}>
              <Plus className="h-4 w-4" /> Add Member
            </Button>
          ) : undefined
        }
      />
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {showAdd && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Add Team Member</CardTitle>
                <button onClick={() => setShowAdd(false)} className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleAddMember} className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700">Email *</label>
                  <Input type="email" value={addForm.email} onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))} required placeholder="staff@merchant.com" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700">Name</label>
                  <Input value={addForm.name} onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))} placeholder="Full name" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700">Password *</label>
                  <Input type="password" value={addForm.password} onChange={(e) => setAddForm((f) => ({ ...f, password: e.target.value }))} required placeholder="Temporary password" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700">Role</label>
                  <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={addForm.role} onChange={(e) => setAddForm((f) => ({ ...f, role: e.target.value }))}>
                    <option value="staff">Staff</option>
                    <option value="manager">Manager</option>
                    <option value="owner">Owner</option>
                  </select>
                </div>
                {addError && <div className="col-span-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{addError}</div>}
                <div className="col-span-2 flex gap-3">
                  <Button type="submit" disabled={addLoading}>{addLoading ? "Adding…" : "Add Member"}</Button>
                  <Button type="button" variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  <th className="px-5 py-3">Name / Email</th>
                  <th className="px-5 py-3">Role</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Joined</th>
                  {isOwner && <th className="px-5 py-3">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {members.map((m) => (
                  <tr key={m.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3">
                      <p className="font-medium text-gray-900">{m.name ?? "—"}</p>
                      <p className="text-xs text-gray-500">{m.email}</p>
                    </td>
                    <td className="px-5 py-3">
                      {isOwner ? (
                        <select
                          className={`rounded-full px-3 py-1 text-xs font-medium border-0 cursor-pointer ${roleColor[m.role]}`}
                          value={m.role}
                          onChange={(e) => handleRoleChange(m, e.target.value)}
                        >
                          <option value="staff">Staff</option>
                          <option value="manager">Manager</option>
                          <option value="owner">Owner</option>
                        </select>
                      ) : (
                        <span className={`rounded-full px-3 py-1 text-xs font-medium ${roleColor[m.role]}`}>{m.role}</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <Badge className={m.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-700"}>
                        {m.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-gray-500 text-xs">{formatDate(m.created_at)}</td>
                    {isOwner && (
                      <td className="px-5 py-3">
                        <button
                          onClick={() => handleToggleActive(m)}
                          className="text-xs text-[#238D9D] hover:underline"
                        >
                          {m.is_active ? "Deactivate" : "Activate"}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
