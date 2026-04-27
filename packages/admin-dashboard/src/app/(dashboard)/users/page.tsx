import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { TopBar } from "@/components/layout/TopBar";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

async function getUsers() {
  const [usersRes, flagsRes] = await Promise.all([
    supabase.from("akiba_users").select("id, address, username, phone, created_at").order("created_at", { ascending: false }).limit(100),
    supabase.from("wallet_risk_flags").select("user_address, flag_type").eq("is_active", true),
  ]);
  const flags: Record<string, string[]> = {};
  for (const flag of flagsRes.data ?? []) {
    const key = flag.user_address?.toLowerCase();
    if (!key) continue;
    flags[key] = [...(flags[key] ?? []), flag.flag_type];
  }
  return (usersRes.data ?? []).map((user) => ({
    ...user,
    flags: flags[(user.address ?? user.id ?? "").toLowerCase()] ?? [],
  }));
}

export default async function UsersPage() {
  const session = await requireAdminSession("users.read");
  if (!session) redirect("/login");

  const users = await getUsers();

  return (
    <div>
      <TopBar title="Users & Wallets" subtitle="Wallet lookup, user identity, and active risk flags" />
      <div className="p-6">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-xs font-medium uppercase tracking-wider text-slate-400">
                <th className="px-4 py-3 text-left">Wallet</th>
                <th className="px-4 py-3 text-left">User</th>
                <th className="px-4 py-3 text-left">Flags</th>
                <th className="px-4 py-3 text-left">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">No users found.</td></tr>}
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{user.address ?? user.id}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{user.username ?? "—"}</p>
                    <p className="text-xs text-slate-400">{user.phone ?? "No phone"}</p>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {user.flags.length === 0 ? <span className="text-slate-400">—</span> : user.flags.map((flag) => <Badge key={flag} variant="warning">{flag}</Badge>)}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(user.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
