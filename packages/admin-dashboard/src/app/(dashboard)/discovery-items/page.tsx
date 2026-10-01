import { redirect } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DiscoveryItemActions } from "@/components/discovery/DiscoveryItemActions";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { hasPermission } from "@/types";
import { formatDateTime } from "@/lib/utils";

// Customer-generated discovery-item candidate queue
// (verified-discovery-acquisition-v1-spec.md §9.3, §13.3). Items here were
// created only from eligible customer purchase mentions, never merchant
// product setup — a merchant can report one through Akiba-Platform, but
// qualify/suppress/merge decisions are made here.
interface ItemRow {
  id: string;
  partner_id: string;
  canonical_name: string;
  category: string | null;
  status: string;
  first_seen_at: string;
  partners: { name: string } | null;
}

async function getCandidateItems(): Promise<{ rows: ItemRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from("merchant_discovery_items")
    .select("id, partner_id, canonical_name, category, status, first_seen_at, partners(name)")
    .in("status", ["candidate"])
    .order("first_seen_at", { ascending: true })
    .limit(100);

  if (error) {
    console.error("[discovery-items] queue failed", error.message);
    return { rows: [], error: "The discovery-item queue could not be loaded." };
  }
  return { rows: (data ?? []) as unknown as ItemRow[], error: null };
}

export default async function DiscoveryItemsPage() {
  const session = await requireAdminSession("discovery.read");
  if (!session) redirect("/login");

  const { rows, error } = await getCandidateItems();
  const canWrite = hasPermission(session.role, "discovery.write");

  return (
    <div>
      <TopBar
        title="Discovery Items"
        subtitle="Customer-generated product candidates awaiting qualification"
      />
      <div className="space-y-6 p-6">
        {error && (
          <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Candidates ({rows.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 px-4 py-10 text-center">
                <p className="text-sm font-medium text-slate-900">No candidates waiting</p>
                <p className="mt-1 text-sm text-slate-500">
                  New customer-named items will appear here once they&apos;re mentioned.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {rows.map((row) => (
                  <div key={row.id} className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-slate-100 p-4">
                    <div>
                      <p className="font-medium text-slate-900">{row.canonical_name}</p>
                      <p className="text-xs text-slate-400">
                        {row.partners?.name ?? "Unknown merchant"} · {row.category ?? "Uncategorised"} · first seen{" "}
                        {formatDateTime(row.first_seen_at)}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">ID: {row.id}</p>
                      <Badge variant="warning">{row.status}</Badge>
                    </div>
                    {canWrite ? (
                      <DiscoveryItemActions itemId={row.id} />
                    ) : (
                      <p className="text-xs text-slate-400">Read-only access</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
