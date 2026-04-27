import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { TopBar } from "@/components/layout/TopBar";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";

async function getIncidents() {
  const { data } = await supabase
    .from("ops_incidents")
    .select("id, incident_type, status, title, description, target_type, target_id, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  return data ?? [];
}

export default async function OpsQueuePage() {
  const session = await requireAdminSession("incidents.read");
  if (!session) redirect("/login");

  const incidents = await getIncidents();

  return (
    <div>
      <TopBar title="Ops Queue" subtitle="Manual review and operational incidents" />
      <div className="p-6">
        <div className="space-y-2">
          {incidents.length === 0 && <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">No incidents in the queue.</div>}
          {incidents.map((incident) => (
            <div key={incident.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-slate-900">{incident.title}</p>
                    <Badge variant={incident.status === "resolved" ? "success" : incident.status === "in_progress" ? "warning" : "secondary"}>{incident.status}</Badge>
                    <Badge variant="outline">{incident.incident_type}</Badge>
                  </div>
                  {incident.description && <p className="mt-1 text-sm text-slate-500">{incident.description}</p>}
                  {incident.target_id && <p className="mt-1 text-xs text-slate-400">{incident.target_type}: {incident.target_id}</p>}
                </div>
                <p className="shrink-0 text-xs text-slate-400">{formatDateTime(incident.created_at)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
