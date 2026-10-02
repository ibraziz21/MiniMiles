import { redirect } from "next/navigation";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireAdminSession } from "@/lib/auth";
import { getVerifiedDiscoveryHealth } from "@/lib/verifiedDiscoveryHealth";

// Read-only operational view for the verified-discovery hardening work
// (verified-discovery-market-readiness-hardening-spec.md §8.3 "dashboards").
// Mirrors packages/hub-page's GET /api/internal/verified-discovery-health
// (same metrics, same warning thresholds) as a page instead of a curl
// target, since this is the first such health check someone on this team
// would actually want to look at without a terminal. See
// verified-discovery-runbook.md for what to do about anything shown unhealthy
// here, and note that feature-kill-switch state (HUB_DISCOVERY_* env vars)
// lives on the hub-page deployment, not this one — this page can't report it.
function ms(value: number): string {
  if (value < 1000) return `${value}ms`;
  const minutes = value / 60_000;
  if (minutes < 1) return `${Math.round(value / 1000)}s`;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  return `${Math.round(minutes / 60)}h`;
}

export default async function VerifiedDiscoveryHealthPage() {
  const session = await requireAdminSession("discovery.read");
  if (!session) redirect("/login");

  const health = await getVerifiedDiscoveryHealth();

  return (
    <div>
      <TopBar title="Discovery Health" subtitle="Verified-discovery queues, moderation audit integrity and projection freshness" />
      <div className="space-y-6 p-6">
        {health.error ? (
          <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {health.error}
          </div>
        ) : (
          <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm ${health.healthy ? "border-green-200 bg-green-50 text-green-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
            {health.healthy ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
            <div>
              <p className="font-medium">{health.healthy ? "Healthy" : "Needs attention"}</p>
              {health.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardHeader><CardTitle className="text-sm font-medium text-slate-500">Photo processing</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>Pending: <span className="font-semibold">{health.photoProcessingQueue.pending}</span></p>
              <p>Processing: <span className="font-semibold">{health.photoProcessingQueue.processing}</span></p>
              <p>Failed: <span className="font-semibold">{health.photoProcessingQueue.failed}</span></p>
              <p>Oldest pending: <span className="font-semibold">{ms(health.photoProcessingQueue.oldestPendingAgeMs)}</span></p>
              {health.photoProcessingQueue.stuck > 0 && <Badge variant="warning">{health.photoProcessingQueue.stuck} stuck</Badge>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm font-medium text-slate-500">Moderation queue</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>Pending: <span className="font-semibold">{health.moderationQueue.pending}</span></p>
              <p>Oldest pending: <span className="font-semibold">{ms(health.moderationQueue.oldestPendingAgeMs)}</span></p>
              {health.moderationQueue.missingAuditCount > 0 && (
                <Badge variant="warning">{health.moderationQueue.missingAuditCount} missing audit event</Badge>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm font-medium text-slate-500">Projection queue (shadow)</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>Pending: <span className="font-semibold">{health.projectionQueue.pending}</span></p>
              <p>Processing: <span className="font-semibold">{health.projectionQueue.processing}</span></p>
              <p>Failed: <span className="font-semibold">{health.projectionQueue.failed}</span></p>
              <p>Oldest pending: <span className="font-semibold">{ms(health.projectionQueue.oldestPendingAgeMs)}</span></p>
              {health.projectionQueue.stuck > 0 && <Badge variant="warning">{health.projectionQueue.stuck} stuck</Badge>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm font-medium text-slate-500">Snapshots (shadow)</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>Eligible merchants: <span className="font-semibold">{health.snapshots.count}</span></p>
              <p>Oldest: <span className="font-semibold">{ms(health.snapshots.oldestAgeMs)}</span></p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
