import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertCircle, ArrowRight, CheckCircle2, Clock3, PauseCircle, ShieldX } from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/ui/metric-card";
import { EmptyState } from "@/components/ui/empty-state";
import { requireAdminSession } from "@/lib/auth";
import { directoryStatusLabel } from "@/lib/merchant-directory-review";
import { supabase } from "@/lib/supabase";
import { formatDateTime } from "@/lib/utils";

interface DirectoryRow {
  partner_id: string;
  directory_status: string;
  directory_submitted_at: string | null;
  directory_published_at: string | null;
  directory_updated_at: string | null;
  partners: {
    name: string;
    slug: string;
    status: string;
    type: string;
  } | null;
}

const STATUS_VARIANT: Record<string, "success" | "warning" | "destructive" | "secondary" | "outline"> = {
  pending_review: "warning",
  changes_requested: "destructive",
  published: "success",
  paused: "secondary",
  suspended: "destructive",
  draft: "outline",
};

async function getDirectoryProfiles(): Promise<{ rows: DirectoryRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from("partner_settings")
    .select(
      "partner_id, directory_status, directory_submitted_at, directory_published_at, directory_updated_at, partners(name, slug, status, type)",
    )
    .neq("directory_status", "draft")
    .order("directory_updated_at", { ascending: false });

  if (error) {
    console.error("[directory-reviews] queue failed", error.message);
    return { rows: [], error: "The merchant directory review queue could not be loaded." };
  }

  return { rows: (data ?? []) as unknown as DirectoryRow[], error: null };
}

export default async function DirectoryReviewsPage() {
  const session = await requireAdminSession("merchants.read");
  if (!session) redirect("/login");

  const { rows, error } = await getDirectoryProfiles();
  const pending = rows
    .filter((row) => row.directory_status === "pending_review")
    .sort((a, b) =>
      (a.directory_submitted_at ?? "").localeCompare(b.directory_submitted_at ?? ""),
    );
  const counts = {
    pending: pending.length,
    published: rows.filter((row) => row.directory_status === "published").length,
    changes: rows.filter((row) => row.directory_status === "changes_requested").length,
    suspended: rows.filter((row) => row.directory_status === "suspended").length,
  };

  return (
    <div>
      <PageHeader
        title="Merchant Profile Reviews"
        subtitle="Verify public business details before they appear in Hub"
      />
      <div className="space-y-6 p-4 sm:p-6">
        {error && (
          <div className="flex items-center gap-3 rounded-card border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Awaiting review" value={String(counts.pending)} icon={Clock3} tone={counts.pending > 0 ? "warning" : "neutral"} />
          <MetricCard label="Published" value={String(counts.published)} icon={CheckCircle2} tone="success" />
          <MetricCard label="Changes requested" value={String(counts.changes)} icon={PauseCircle} tone={counts.changes > 0 ? "warning" : "neutral"} />
          <MetricCard label="Suspended" value={String(counts.suspended)} icon={ShieldX} tone={counts.suspended > 0 ? "danger" : "neutral"} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Awaiting review ({pending.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {pending.length === 0 ? (
              <EmptyState icon={CheckCircle2} message="Review queue is clear. New merchant submissions will appear here automatically." isHealthy />
            ) : (
              <>
                {/* Mobile: cards */}
                <div className="space-y-3 lg:hidden">
                  {pending.map((row) => (
                    <Link
                      key={row.partner_id}
                      href={`/directory-reviews/${row.partner_id}`}
                      className="block rounded-card border border-border p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-ink">{row.partners?.name ?? "Unnamed merchant"}</p>
                          <p className="text-xs text-ink-muted">/{row.partners?.slug ?? "—"}</p>
                        </div>
                        <Badge variant={row.partners?.status === "active" ? "success" : "destructive"}>
                          {row.partners?.status ?? "unknown"}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-ink-muted">Submitted {formatDateTime(row.directory_submitted_at)}</p>
                    </Link>
                  ))}
                </div>

                {/* Desktop: table */}
                <div className="hidden overflow-x-auto lg:block">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs font-medium uppercase tracking-wider text-ink-muted">
                        <th className="pb-3 text-left">Merchant</th>
                        <th className="pb-3 text-left">Account</th>
                        <th className="pb-3 text-left">Submitted</th>
                        <th className="pb-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {pending.map((row) => (
                        <tr key={row.partner_id}>
                          <td className="py-3">
                            <p className="font-medium text-ink">
                              {row.partners?.name ?? "Unnamed merchant"}
                            </p>
                            <p className="text-xs text-ink-muted">/{row.partners?.slug ?? "—"}</p>
                          </td>
                          <td className="py-3">
                            <Badge variant={row.partners?.status === "active" ? "success" : "destructive"}>
                              {row.partners?.status ?? "unknown"}
                            </Badge>
                          </td>
                          <td className="py-3 text-ink-muted">
                            {formatDateTime(row.directory_submitted_at)}
                          </td>
                          <td className="py-3 text-right">
                            <Link
                              href={`/directory-reviews/${row.partner_id}`}
                              className="inline-flex items-center gap-1.5 font-medium text-primary hover:text-primary-strong"
                            >
                              Review profile
                              <ArrowRight className="h-3.5 w-3.5" />
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {rows.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Directory profiles</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {rows.slice(0, 20).map((row) => (
                <Link
                  key={row.partner_id}
                  href={`/directory-reviews/${row.partner_id}`}
                  className="flex items-center justify-between rounded-card border border-border px-3 py-3 transition-colors hover:bg-surface-subtle"
                >
                  <div>
                    <p className="text-sm font-medium text-ink">
                      {row.partners?.name ?? "Unnamed merchant"}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      Updated {formatDateTime(row.directory_updated_at)}
                    </p>
                  </div>
                  <Badge variant={STATUS_VARIANT[row.directory_status] ?? "secondary"}>
                    {directoryStatusLabel(row.directory_status)}
                  </Badge>
                </Link>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
