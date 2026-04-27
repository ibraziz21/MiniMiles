import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { TopBar } from "@/components/layout/TopBar";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";

async function getAuditLog() {
  const { data } = await supabase
    .from("admin_audit_logs")
    .select("id, action, target_type, target_id, metadata, ip_address, created_at, admin_users(name, email)")
    .order("created_at", { ascending: false })
    .limit(100);
  return (data ?? []) as unknown as Array<{
    id: string;
    action: string;
    target_type: string | null;
    target_id: string | null;
    created_at: string;
    admin_users: { name: string | null; email: string } | null;
  }>;
}

export default async function AuditLogPage() {
  const session = await requireAdminSession("audit.read");
  if (!session) redirect("/login");

  const entries = await getAuditLog();

  return (
    <div>
      <TopBar title="Audit Log" subtitle="Sensitive admin actions and authentication events" />
      <div className="p-6">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-xs font-medium uppercase tracking-wider text-slate-400">
                <th className="px-4 py-3 text-left">Action</th>
                <th className="px-4 py-3 text-left">Admin</th>
                <th className="px-4 py-3 text-left">Target</th>
                <th className="px-4 py-3 text-left">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">No audit entries yet.</td></tr>}
              {entries.map((entry) => (
                <tr key={entry.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3"><Badge>{entry.action}</Badge></td>
                  <td className="px-4 py-3 text-slate-700">{entry.admin_users?.name ?? entry.admin_users?.email ?? "System"}</td>
                  <td className="px-4 py-3 text-slate-500">{entry.target_type ? `${entry.target_type}: ${entry.target_id ?? "—"}` : "—"}</td>
                  <td className="px-4 py-3 text-slate-500">{formatDateTime(entry.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
