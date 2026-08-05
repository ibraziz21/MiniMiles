import { redirect } from "next/navigation";
import { BellRing, CheckCircle2, Send, Smartphone, Users } from "lucide-react";
import { requireAdminSession } from "@/lib/auth";
import { hasPermission } from "@/types";
import { supabase } from "@/lib/supabase";
import { formatDateTime } from "@/lib/utils";
import { TopBar } from "@/components/layout/TopBar";
import { PushCampaignComposer } from "@/components/push/PushCampaignComposer";
import { Badge } from "@/components/ui/badge";

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
      <TopBar title="Push Notifications" subtitle="Send opt-in announcements through the Akiba PWA" />
      <div className="space-y-6 p-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Opted-in users", value: audience.length, icon: Users },
            { label: "Active devices", value: activeDevices, icon: Smartphone },
            { label: "Campaigns", value: campaigns.length, icon: Send },
            { label: "Accepted deliveries", value: acceptedDeliveries, icon: CheckCircle2 },
          ].map((stat) => (
            <div key={stat.label} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-500">{stat.label}</p>
                <stat.icon className="h-4 w-4 text-[#238D9D]" />
              </div>
              <p className="mt-2 text-3xl font-semibold text-slate-950">{stat.value.toLocaleString()}</p>
            </div>
          ))}
        </div>

        {!pushSchemaReady ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
            Push campaigns are not available in this environment yet. Apply Supabase migration 062 before sending announcements.
          </div>
        ) : canWrite ? (
          <PushCampaignComposer audienceCount={audience.length} />
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
            You have read-only access to notification campaigns. A super or operations admin must send them.
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-slate-950">Campaign history</h2>
              <p className="mt-0.5 text-sm text-slate-500">Provider acceptance and durable job outcomes</p>
            </div>
            <BellRing className="h-5 w-5 text-[#238D9D]" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-xs font-medium uppercase tracking-wider text-slate-400">
                  <th className="px-4 py-3 text-left">Campaign</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-right">Audience</th>
                  <th className="px-4 py-3 text-right">Processed</th>
                  <th className="px-4 py-3 text-right">Accepted devices</th>
                  <th className="px-4 py-3 text-left">Created by</th>
                  <th className="px-4 py-3 text-left">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {campaigns.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">No campaigns sent yet.</td></tr>
                )}
                {campaigns.map((campaign) => (
                  <tr key={campaign.id} className="hover:bg-slate-50">
                    <td className="max-w-sm px-4 py-3">
                      <p className="truncate font-medium text-slate-900">{campaign.title}</p>
                      <p className="mt-0.5 truncate text-xs text-slate-500">{campaign.body}</p>
                    </td>
                    <td className="px-4 py-3"><Badge variant="secondary">{campaign.campaign_type}</Badge></td>
                    <td className="px-4 py-3 text-right font-mono text-slate-700">{campaign.queued_count}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-700">{campaign.processed_recipients}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-700">{campaign.accepted_deliveries}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{campaign.created_by ?? "System"}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{formatDateTime(campaign.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
