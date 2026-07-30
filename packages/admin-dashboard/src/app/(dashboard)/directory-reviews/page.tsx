import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertCircle, ArrowRight, CheckCircle2, Clock3, PauseCircle, ShieldX } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
      <TopBar
        title="Merchant Profile Reviews"
        subtitle="Verify public business details before they appear in Hub"
      />
      <div className="space-y-6 p-6">
        {error && (
          <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardContent className="flex items-center gap-4 p-5">
              <Clock3 className="h-8 w-8 text-amber-500" />
              <div>
                <p className="text-2xl font-semibold text-slate-950">{counts.pending}</p>
                <p className="text-sm text-slate-500">Awaiting review</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-4 p-5">
              <CheckCircle2 className="h-8 w-8 text-emerald-500" />
              <div>
                <p className="text-2xl font-semibold text-slate-950">{counts.published}</p>
                <p className="text-sm text-slate-500">Published</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-4 p-5">
              <PauseCircle className="h-8 w-8 text-orange-500" />
              <div>
                <p className="text-2xl font-semibold text-slate-950">{counts.changes}</p>
                <p className="text-sm text-slate-500">Changes requested</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-4 p-5">
              <ShieldX className="h-8 w-8 text-red-500" />
              <div>
                <p className="text-2xl font-semibold text-slate-950">{counts.suspended}</p>
                <p className="text-sm text-slate-500">Suspended</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Awaiting review ({pending.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {pending.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 px-4 py-10 text-center">
                <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500" />
                <p className="mt-3 text-sm font-medium text-slate-900">Review queue is clear</p>
                <p className="mt-1 text-sm text-slate-500">
                  New merchant submissions will appear here automatically.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-xs font-medium uppercase tracking-wider text-slate-400">
                      <th className="pb-3 text-left">Merchant</th>
                      <th className="pb-3 text-left">Account</th>
                      <th className="pb-3 text-left">Submitted</th>
                      <th className="pb-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {pending.map((row) => (
                      <tr key={row.partner_id}>
                        <td className="py-3">
                          <p className="font-medium text-slate-900">
                            {row.partners?.name ?? "Unnamed merchant"}
                          </p>
                          <p className="text-xs text-slate-400">/{row.partners?.slug ?? "—"}</p>
                        </td>
                        <td className="py-3">
                          <Badge variant={row.partners?.status === "active" ? "success" : "destructive"}>
                            {row.partners?.status ?? "unknown"}
                          </Badge>
                        </td>
                        <td className="py-3 text-slate-600">
                          {formatDateTime(row.directory_submitted_at)}
                        </td>
                        <td className="py-3 text-right">
                          <Link
                            href={`/directory-reviews/${row.partner_id}`}
                            className="inline-flex items-center gap-1.5 font-medium text-[#176B78] hover:text-[#125762]"
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
                  className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-3 transition-colors hover:bg-slate-50"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {row.partners?.name ?? "Unnamed merchant"}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">
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
