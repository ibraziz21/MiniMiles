import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/shell/PageHeader";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/lib/utils";
import { CreateAdminUserForm } from "@/components/team/CreateAdminUserForm";

async function getTeam() {
  const { data } = await supabase
    .from("admin_users")
    .select("id, email, name, role, is_active, must_change_password, last_login_at, created_at")
    .order("created_at", { ascending: false });
  return data ?? [];
}

export default async function AdminTeamPage() {
  const session = await requireAdminSession("audit.read");
  if (!session) redirect("/login");

  const team = await getTeam();

  return (
    <div>
      <PageHeader title="Admin Team" subtitle="Internal AkibaMiles admin accounts" />
      <div className="space-y-4 p-4 sm:p-6">
        {session.role === "super_admin" && <CreateAdminUserForm />}

        {team.length === 0 ? (
          <EmptyState message="No admin users found." isHealthy={false} />
        ) : (
          <>
            {/* Mobile: cards */}
            <div className="space-y-3 lg:hidden">
              {team.map((admin) => (
                <div key={admin.id} className="rounded-card border border-border bg-surface p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-ink">{admin.name ?? admin.email}</p>
                      <p className="text-xs text-ink-muted">{admin.email}</p>
                    </div>
                    <Badge variant="secondary">{admin.role}</Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge variant={admin.is_active ? "success" : "destructive"}>{admin.is_active ? "active" : "disabled"}</Badge>
                    {admin.must_change_password && <Badge variant="warning">temp password</Badge>}
                    <span className="text-xs text-ink-muted">Last login {formatDate(admin.last_login_at)}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop: table */}
            <div className="hidden overflow-hidden rounded-card border border-border bg-surface lg:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-subtle text-xs font-medium uppercase tracking-wider text-ink-muted">
                    <th className="px-4 py-3 text-left">Admin</th>
                    <th className="px-4 py-3 text-left">Role</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Last Login</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {team.map((admin) => (
                    <tr key={admin.id} className="hover:bg-surface-subtle">
                      <td className="px-4 py-3">
                        <p className="font-medium text-ink">{admin.name ?? admin.email}</p>
                        <p className="text-xs text-ink-muted">{admin.email}</p>
                      </td>
                      <td className="px-4 py-3"><Badge variant="secondary">{admin.role}</Badge></td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <Badge variant={admin.is_active ? "success" : "destructive"}>{admin.is_active ? "active" : "disabled"}</Badge>
                          {admin.must_change_password && <Badge variant="warning">temp password</Badge>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-ink-muted">{formatDate(admin.last_login_at)}</td>
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
