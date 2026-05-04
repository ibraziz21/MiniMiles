import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { TopBar } from "@/components/layout/TopBar";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { InviteAdminForm } from "@/components/team/InviteAdminForm";
import { ADMIN_ROLE_LABELS, hasPermission, type AdminRole } from "@/types";

async function getTeam() {
  const { data } = await supabase
    .from("admin_users")
    .select("id, email, name, role, is_active, password_setup_expires_at, password_set_at, last_login_at, created_at")
    .order("created_at", { ascending: false });
  return data ?? [];
}

export default async function AdminTeamPage() {
  const session = await requireAdminSession("audit.read");
  if (!session) redirect("/login");

  const team = await getTeam();
  const canManageTeam = hasPermission(session.role, "team.write");

  return (
    <div>
      <TopBar title="Admin Team" subtitle="Internal AkibaMiles admin accounts" />
      <div className="p-6">
        {canManageTeam && <InviteAdminForm />}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-xs font-medium uppercase tracking-wider text-slate-400">
                <th className="px-4 py-3 text-left">Admin</th>
                <th className="px-4 py-3 text-left">Role</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Last Login</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {team.map((admin) => (
                <tr key={admin.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{admin.name ?? admin.email}</p>
                    <p className="text-xs text-slate-400">{admin.email}</p>
                  </td>
                  <td className="px-4 py-3"><Badge variant="secondary">{ADMIN_ROLE_LABELS[admin.role as AdminRole]}</Badge></td>
                  <td className="px-4 py-3">
                    {admin.password_setup_expires_at && !admin.password_set_at ? (
                      <Badge variant="warning">invited</Badge>
                    ) : (
                      <Badge variant={admin.is_active ? "success" : "destructive"}>{admin.is_active ? "active" : "disabled"}</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(admin.last_login_at)}</td>
                </tr>
              ))}
              {team.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">No admin users found.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
