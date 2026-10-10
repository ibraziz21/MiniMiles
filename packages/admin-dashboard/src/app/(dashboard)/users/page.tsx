import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/shell/PageHeader";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
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
      <PageHeader title="Members" subtitle="Member identity and active risk flags" />
      <div className="p-4 sm:p-6">
        {users.length === 0 ? (
          <EmptyState message="No members found." isHealthy={false} />
        ) : (
          <>
            {/* Mobile: cards */}
            <div className="space-y-3 lg:hidden">
              {users.map((user) => (
                <div key={user.id} className="rounded-card border border-border bg-surface p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-ink">{user.username ?? "Member"}</p>
                      <p className="text-xs text-ink-muted">{user.phone ?? "—"}</p>
                    </div>
                    <p className="text-xs text-ink-muted">{formatDate(user.created_at)}</p>
                  </div>
                  <p className="mt-1 font-mono text-xs text-ink-muted">{user.address ?? "—"}</p>
                  {user.flags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {user.flags.map((flag) => <Badge key={flag} variant="warning">{flag}</Badge>)}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Desktop: table */}
            <div className="hidden overflow-hidden rounded-card border border-border bg-surface lg:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-subtle text-xs font-medium uppercase tracking-wider text-ink-muted">
                    <th className="px-4 py-3 text-left">Member</th>
                    <th className="px-4 py-3 text-left">Contact</th>
                    <th className="px-4 py-3 text-left">Legacy identifier</th>
                    <th className="px-4 py-3 text-left">Flags</th>
                    <th className="px-4 py-3 text-left">Joined</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {users.map((user) => (
                    <tr key={user.id} className="hover:bg-surface-subtle">
                      <td className="px-4 py-3">
                        <p className="font-medium text-ink">{user.username ?? "Member"}</p>
                        <p className="font-mono text-xs text-ink-muted">{user.id}</p>
                      </td>
                      <td className="px-4 py-3 text-ink-muted">{user.phone ?? "—"}</td>
                      <td className="px-4 py-3 font-mono text-xs text-ink-muted">{user.address ?? "—"}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {user.flags.length === 0 ? <span className="text-ink-muted">—</span> : user.flags.map((flag) => <Badge key={flag} variant="warning">{flag}</Badge>)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-ink-muted">{formatDate(user.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
