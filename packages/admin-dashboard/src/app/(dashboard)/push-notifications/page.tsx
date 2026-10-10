import { redirect } from "next/navigation";
import { BellRing, CheckCircle2, Send, Smartphone, Users } from "lucide-react";
import { requireAdminSession } from "@/lib/auth";
import { hasPermission } from "@/types";
import { supabase } from "@/lib/supabase";
import { formatDateTime } from "@/lib/utils";
import { PageHeader } from "@/components/shell/PageHeader";
import { PushCampaignComposer } from "@/components/push/PushCampaignComposer";
import { Badge } from "@/components/ui/badge";
import { MetricCard } from "@/components/ui/metric-card";
import { EmptyState } from "@/components/ui/empty-state";

type AudienceRow = { hub_user_id: string; active_device_count: number };
type CampaignRow = {
  id: string;
  campaign_type: "feature" | "merchant" | "general";
  title: string;
  body: string;
  deep_link: string;
  status: "queued" | "no_audience";
  audience_count: number;
  queued_count: number;
  processed_recipients: number;
  dead_recipients: number;
  suppressed_recipients: number;
  accepted_deliveries: number;
  created_by: string | null;
  created_at: string;
};

export default async function PushNotificationsPage() {
  const session = await requireAdminSession("notifications.read");
  if (!session) redirect("/login");

  const [audienceResult, campaignResult] = await Promise.all([
    supabase.from("v_web_push_marketing_audience").select("hub_user_id, active_device_count"),
    supabase
      .from("v_web_push_campaign_delivery_stats")
      .select("id, campaign_type, title, body, deep_link, status, audience_count, queued_count, processed_recipients, dead_recipients, suppressed_recipients, accepted_deliveries, created_by, created_at")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const { data: audienceData } = audienceResult;
  const { data: campaignData } = campaignResult;
  const pushSchemaReady = !audienceResult.error && !campaignResult.error;
  const audience = (audienceData ?? []) as AudienceRow[];
  const campaigns = (campaignData ?? []) as CampaignRow[];
  const activeDevices = audience.reduce((sum, row) => sum + row.active_device_count, 0);
  const acceptedDeliveries = campaigns.reduce((sum, campaign) => sum + campaign.accepted_deliveries, 0);
  const canWrite = hasPermission(session.role, "notifications.write");

  return (
    <div>
      <PageHeader title="Push Notifications" subtitle="Send opt-in announcements through the Akiba PWA" />
      <div className="space-y-6 p-4 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Opted-in users" value={audience.length.toLocaleString()} icon={Users} />
          <MetricCard label="Active devices" value={activeDevices.toLocaleString()} icon={Smartphone} />
          <MetricCard label="Campaigns" value={campaigns.length.toLocaleString()} icon={Send} />
          <MetricCard label="Accepted deliveries" value={acceptedDeliveries.toLocaleString()} icon={CheckCircle2} />
        </div>

        {!pushSchemaReady ? (
          <div className="rounded-card border border-danger/30 bg-danger/5 p-5 text-sm text-danger">
            Push campaigns are not available in this environment yet. Apply Supabase migration 062 before sending announcements.
          </div>
        ) : canWrite ? (
          <PushCampaignComposer audienceCount={audience.length} />
        ) : (
          <div className="rounded-card border border-border bg-surface p-5 text-sm text-ink-muted">
            You have read-only access to notification campaigns. A super or operations admin must send them.
          </div>
        )}

        <div className="overflow-hidden rounded-card border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-ink">Campaign history</h2>
              <p className="mt-0.5 text-sm text-ink-muted">Provider acceptance and durable job outcomes</p>
            </div>
            <BellRing className="h-5 w-5 text-primary" />
          </div>

          {campaigns.length === 0 ? (
            <EmptyState message="No campaigns sent yet." isHealthy className="border-0" />
          ) : (
            <>
              {/* Mobile: cards */}
              <div className="space-y-3 p-4 lg:hidden">
                {campaigns.map((campaign) => (
                  <div key={campaign.id} className="rounded-card border border-border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate font-medium text-ink">{campaign.title}</p>
                      <Badge variant="secondary">{campaign.campaign_type}</Badge>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-ink-muted">{campaign.body}</p>
                    <p className="mt-2 text-xs text-ink-muted">
                      Audience {campaign.queued_count} · Processed {campaign.processed_recipients} · Accepted {campaign.accepted_deliveries}
                    </p>
                    <p className="mt-1 text-xs text-ink-muted">
                      {campaign.created_by ?? "System"} · {formatDateTime(campaign.created_at)}
                    </p>
                  </div>
                ))}
              </div>

              {/* Desktop: table */}
              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full min-w-[900px] text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-subtle text-xs font-medium uppercase tracking-wider text-ink-muted">
                      <th className="px-4 py-3 text-left">Campaign</th>
                      <th className="px-4 py-3 text-left">Type</th>
                      <th className="px-4 py-3 text-right">Audience</th>
                      <th className="px-4 py-3 text-right">Processed</th>
                      <th className="px-4 py-3 text-right">Accepted devices</th>
                      <th className="px-4 py-3 text-left">Created by</th>
                      <th className="px-4 py-3 text-left">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {campaigns.map((campaign) => (
                      <tr key={campaign.id} className="hover:bg-surface-subtle">
                        <td className="max-w-sm px-4 py-3">
                          <p className="truncate font-medium text-ink">{campaign.title}</p>
                          <p className="mt-0.5 truncate text-xs text-ink-muted">{campaign.body}</p>
                        </td>
                        <td className="px-4 py-3"><Badge variant="secondary">{campaign.campaign_type}</Badge></td>
                        <td className="px-4 py-3 text-right font-mono text-ink">{campaign.queued_count}</td>
                        <td className="px-4 py-3 text-right font-mono text-ink">{campaign.processed_recipients}</td>
                        <td className="px-4 py-3 text-right font-mono text-ink">{campaign.accepted_deliveries}</td>
                        <td className="px-4 py-3 text-xs text-ink-muted">{campaign.created_by ?? "System"}</td>
                        <td className="px-4 py-3 text-xs text-ink-muted">{formatDateTime(campaign.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
