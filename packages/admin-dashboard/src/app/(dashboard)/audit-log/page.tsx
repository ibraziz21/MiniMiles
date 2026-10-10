import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/shell/PageHeader";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
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
      <PageHeader title="Audit Log" subtitle="Sensitive admin actions and authentication events" />
      <div className="p-4 sm:p-6">
        {entries.length === 0 ? (
          <EmptyState message="No audit entries yet." isHealthy />
        ) : (
          <>
            {/* Mobile: cards */}
            <div className="space-y-3 lg:hidden">
              {entries.map((entry) => (
                <div key={entry.id} className="rounded-card border border-border bg-surface p-4">
                  <div className="flex items-start justify-between gap-2">
                    <Badge>{entry.action}</Badge>
                    <p className="text-xs text-ink-muted">{formatDateTime(entry.created_at)}</p>
                  </div>
                  <p className="mt-2 text-sm text-ink">{entry.admin_users?.name ?? entry.admin_users?.email ?? "System"}</p>
                  <p className="text-xs text-ink-muted">{entry.target_type ? `${entry.target_type}: ${entry.target_id ?? "—"}` : "—"}</p>
                </div>
              ))}
            </div>

            {/* Desktop: table */}
            <div className="hidden overflow-hidden rounded-card border border-border bg-surface lg:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-subtle text-xs font-medium uppercase tracking-wider text-ink-muted">
                    <th className="px-4 py-3 text-left">Action</th>
                    <th className="px-4 py-3 text-left">Admin</th>
                    <th className="px-4 py-3 text-left">Target</th>
                    <th className="px-4 py-3 text-left">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {entries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-surface-subtle">
                      <td className="px-4 py-3"><Badge>{entry.action}</Badge></td>
                      <td className="px-4 py-3 text-ink-muted">{entry.admin_users?.name ?? entry.admin_users?.email ?? "System"}</td>
                      <td className="px-4 py-3 text-ink-muted">{entry.target_type ? `${entry.target_type}: ${entry.target_id ?? "—"}` : "—"}</td>
                      <td className="px-4 py-3 text-ink-muted">{formatDateTime(entry.created_at)}</td>
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
