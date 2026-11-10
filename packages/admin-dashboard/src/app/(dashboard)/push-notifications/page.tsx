import { redirect } from "next/navigation";
import { BellRing, CheckCircle2, Send, Smartphone, Users } from "lucide-react";
import { requireAdminSession } from "@/lib/auth";
import { hasPermission } from "@/types";
import { voucherReadAll } from "@/lib/voucherCatalogue";
import { supabase } from "@/lib/supabase";
import { formatDateTime } from "@/lib/utils";
import { VoucherHeader } from "@/components/vouchers/VoucherHeader";
import Link from "next/link";
import { VoucherFacts, voucherCard } from "@/components/vouchers/VoucherUi";
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

export default async function PushNotificationsPage({
  searchParams,
}: {
  searchParams: { view?: string; id?: string; q?: string };
}) {
  const session = await requireAdminSession("notifications.read");
  if (!session) redirect("/login");

  const read = async <T,>(fn: () => Promise<T[]>) => {
    try {
      return { data: await fn(), error: null };
    } catch {
      return { data: [], error: true };
    }
  };
  const [audienceResult, campaignResult] = await Promise.all([
    read(() =>
      voucherReadAll((from, to) =>
        supabase
          .from("v_web_push_marketing_audience")
          .select("hub_user_id,active_device_count")
          .order("hub_user_id")
          .range(from, to)
      )
    ),
    read(() =>
      voucherReadAll((from, to) =>
        supabase
          .from("v_web_push_campaign_delivery_stats")
          .select(
            "id,campaign_type,title,body,deep_link,status,audience_count,queued_count,processed_recipients,dead_recipients,suppressed_recipients,accepted_deliveries,created_by,created_at"
          )
          .order("created_at", { ascending: false })
          .order("id")
          .range(from, to)
      )
    ),
  ]);

  const { data: audienceData } = audienceResult;
  const { data: campaignData } = campaignResult;
  const pushSchemaReady = !audienceResult.error && !campaignResult.error;
  const audience = (audienceData ?? []) as AudienceRow[];
  const campaigns = (campaignData ?? []) as CampaignRow[];
  const activeDevices = audience.reduce(
    (sum, row) => sum + row.active_device_count,
    0
  );
  const acceptedDeliveries = campaigns.reduce(
    (sum, campaign) => sum + campaign.accepted_deliveries,
    0
  );
  const canWrite = hasPermission(session.role, "notifications.write");

  const selected = campaigns.find((c) => c.id === searchParams.id);
  const composing = searchParams.view === "compose";
  return (
    <div className="min-h-screen bg-[#FAF8FF]">
      <VoucherHeader
        title={
          selected
            ? "Notification detail"
            : composing
            ? "Compose notification"
            : "Notifications"
        }
        backHref={selected || composing ? "/push-notifications" : undefined}
        name={session.name}
        role={session.role}
      />
      <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
        {!pushSchemaReady ? (
          <p
            role="alert"
            className="rounded-card bg-white p-5 text-sm text-danger"
          >
            Notification campaigns are unavailable in this environment.
          </p>
        ) : composing ? (
          canWrite ? (
            <PushCampaignComposer audienceCount={audience.length} />
          ) : (
            <p>You have read-only access.</p>
          )
        ) : selected ? (
          <>
            <section className={voucherCard}>
              <p className="text-sm capitalize text-primary">
                {selected.status.replaceAll("_", " ")}
              </p>
              <h2 className="mt-3 break-words text-xl font-semibold">
                {selected.title}
              </h2>
              <p className="mt-3 break-words text-sm leading-6 text-ink-muted">
                {selected.body}
              </p>
            </section>
            <section className={voucherCard}>
              <VoucherFacts
                items={[
                  {
                    label: "Created",
                    value: formatDateTime(selected.created_at),
                  },
                  { label: "Audience", value: selected.audience_count },
                  { label: "Queued users", value: selected.queued_count },
                  {
                    label: "Processed recipients",
                    value: selected.processed_recipients,
                  },
                  {
                    label: "Provider accepted deliveries",
                    value: selected.accepted_deliveries,
                  },
                  { label: "Dead recipients", value: selected.dead_recipients },
                  {
                    label: "Suppressed recipients",
                    value: selected.suppressed_recipients,
                  },
                  { label: "Destination", value: selected.deep_link },
                ]}
              />
              <p className="mt-4 text-xs leading-5 text-ink-muted">
                Provider acceptance does not confirm receipt or opening on a
                device.
              </p>
            </section>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-2xl font-semibold">Notifications</h2>
              {canWrite && (
                <Link
                  className="inline-flex min-h-11 items-center rounded-control bg-[#005C55] px-4 text-sm text-white"
                  href="/push-notifications?view=compose"
                >
                  New notification
                </Link>
              )}
            </div>
            <form className="flex gap-2">
              <input
                type="search"
                name="q"
                aria-label="Search notifications"
                defaultValue={searchParams.q}
                placeholder="Search notifications…"
                className="min-h-12 min-w-0 flex-1 rounded-card border-0 bg-white px-4 text-base"
              />
              <button className="min-h-11 rounded-control bg-[#EAEDFF] px-3 text-sm">
                Search
              </button>
            </form>
            <p className="text-xs text-ink-muted">
              Latest {campaigns.length} campaigns · {audience.length} opted-in
              users
            </p>
            {campaigns
              .filter((c) =>
                `${c.title} ${c.body}`
                  .toLowerCase()
                  .includes(searchParams.q?.toLowerCase() ?? "")
              )
              .map((c) => (
                <Link
                  key={c.id}
                  href={`/push-notifications?id=${c.id}`}
                  className="block space-y-3 rounded-card bg-white p-5 shadow-sm focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <div className="flex flex-wrap justify-between gap-2 text-xs">
                    <span className="rounded-full bg-[#D9F9FC] px-3 py-1 capitalize text-primary">
                      {c.status.replaceAll("_", " ")}
                    </span>
                    <span className="text-ink-muted">
                      {formatDateTime(c.created_at)}
                    </span>
                  </div>
                  <h3 className="break-words font-semibold">{c.title}</h3>
                  <p className="line-clamp-2 break-words text-sm leading-6 text-ink-muted">
                    {c.body}
                  </p>
                </Link>
              ))}
            {!campaigns.length && (
              <p className={voucherCard}>No notification campaigns yet.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
