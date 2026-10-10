import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/shell/PageHeader";
import { DetailHeader } from "@/components/shell/DetailHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate, formatDateTime, formatNumber } from "@/lib/utils";
import { AddMerchantNote } from "@/components/merchants/AddMerchantNote";
import { GrantTrialControl } from "@/components/merchants/GrantTrialControl";
import { ShieldCheck, ScrollText } from "lucide-react";
import { hasPermission } from "@/types";

async function getMerchantDetail(id: string) {
  const [partnerRes, settingsRes, subscriptionRes, vouchersRes, teamRes, notesRes, eventsRes] = await Promise.all([
    supabase.from("partners").select("*").eq("id", id).single(),
    supabase
      .from("partner_settings")
      .select("directory_status, directory_submitted_at, directory_published_at, directory_updated_at")
      .eq("partner_id", id)
      .maybeSingle(),
    supabase
      .from("partner_subscriptions")
      .select("plan,status,billing_period,included_monthly_miles,miles_issued_current_period,overage_miles_current_period,period_end,next_renewal_at")
      .eq("partner_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("spend_voucher_templates").select("id, title, active, lifecycle_state, miles_cost").eq("partner_id", id),
    supabase.from("merchant_users").select("id, email, name, role, is_active").eq("partner_id", id),
    supabase.from("merchant_admin_notes").select("id, note, created_at, admin_users(name, email)").eq("partner_id", id).order("created_at", { ascending: false }),
    supabase
      .from("merchant_directory_review_events")
      .select("id, from_status, to_status, action, merchant_safe_message, internal_note, actor_type, created_at")
      .eq("partner_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  if (!partnerRes.data) return null;

  return {
    partner: partnerRes.data,
    settings: settingsRes.data ?? null,
    subscription: subscriptionRes.data ?? null,
    voucher_templates: vouchersRes.data ?? [],
    team: teamRes.data ?? [],
    notes: notesRes.data ?? [],
    events: eventsRes.data ?? [],
  };
}

export default async function MerchantDetailPage({ params }: { params: { id: string } }) {
  const session = await requireAdminSession("merchants.read");
  if (!session) redirect("/login");

  const detail = await getMerchantDetail(params.id);
  if (!detail) notFound();

  const { partner, settings, subscription, voucher_templates, team, notes, events } = detail;
  const activeVoucherTypes = voucher_templates.filter(
    (voucher) => voucher.lifecycle_state === "published" && voucher.active,
  ).length;
  const canManageMerchants = hasPermission(session.role, "merchants.write");

  const typedNotes = notes as unknown as Array<{
    id: string;
    note: string;
    created_at: string;
    admin_users?: { name: string | null; email: string } | null;
  }>;

  return (
    <div>
      <PageHeader title={partner.name} subtitle="Merchant detail" />
      <div className="space-y-6 p-4 sm:p-6">
        <DetailHeader backHref="/merchants" backLabel="Back to merchants" title={partner.name} subtitle={partner.country ?? undefined} />

        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="public-profile">Public profile</TabsTrigger>
            <TabsTrigger value="vouchers">Vouchers ({voucher_templates.length})</TabsTrigger>
            <TabsTrigger value="team">Team ({team.length})</TabsTrigger>
            <TabsTrigger value="notes">Notes ({notes.length})</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-ink-muted">Subscription</CardTitle>
                </CardHeader>
                <CardContent>
                  {subscription ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-2xl font-bold capitalize text-ink">{subscription.plan}</span>
                      <Badge variant={subscription.status === "active" ? "success" : subscription.status === "suspended" ? "destructive" : "secondary"}>
                        {subscription.status.replaceAll("_", " ")}
                      </Badge>
                    </div>
                  ) : (
                    <Badge variant="outline">No subscription</Badge>
                  )}
                  {subscription?.status === "trialing" && subscription.period_end ? (
                    <p className="mt-2 text-xs text-ink-muted">Trial ends {formatDate(subscription.period_end)}</p>
                  ) : null}
                  <GrantTrialControl merchantId={params.id} canManage={canManageMerchants} subscriptionStatus={subscription?.status} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-ink-muted">Active Voucher Types</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold tabular-nums text-ink">{formatNumber(activeVoucherTypes)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-ink-muted">Team Members</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold tabular-nums text-ink">{team.length}</p>
                </CardContent>
              </Card>
            </div>

            {subscription && (
              <Card>
                <CardHeader>
                  <CardTitle>Plan Usage</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <p className="text-xs text-ink-muted">Billing term</p>
                    <p className="mt-1 font-medium capitalize text-ink">{subscription.billing_period ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-ink-muted">Miles issued this month</p>
                    <p className="mt-1 font-medium text-ink">
                      {formatNumber(subscription.miles_issued_current_period ?? 0)} / {formatNumber(subscription.included_monthly_miles ?? 0)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-ink-muted">Overage Miles</p>
                    <p className="mt-1 font-medium text-ink">{formatNumber(subscription.overage_miles_current_period ?? 0)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-ink-muted">Next renewal</p>
                    <p className="mt-1 font-medium text-ink">{subscription.next_renewal_at ? formatDate(subscription.next_renewal_at) : "—"}</p>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="public-profile" className="space-y-4">
            {settings?.directory_status ? (
              <>
                <Card>
                  <CardContent className="space-y-3 pt-6">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{String(settings.directory_status).replaceAll("_", " ")}</Badge>
                    </div>
                    <div className="grid gap-3 text-sm sm:grid-cols-3">
                      <div>
                        <p className="text-xs text-ink-muted">Submitted</p>
                        <p className="mt-1 font-medium text-ink">{settings.directory_submitted_at ? formatDateTime(settings.directory_submitted_at) : "—"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-ink-muted">Published</p>
                        <p className="mt-1 font-medium text-ink">{settings.directory_published_at ? formatDateTime(settings.directory_published_at) : "—"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-ink-muted">Last updated</p>
                        <p className="mt-1 font-medium text-ink">{settings.directory_updated_at ? formatDateTime(settings.directory_updated_at) : "—"}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Link
                  href={`/directory-reviews/${params.id}`}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-control border border-primary/30 bg-primary/5 px-3 py-2 text-sm font-medium text-primary-strong hover:bg-primary/10"
                >
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  Open full profile review
                </Link>
              </>
            ) : (
              <EmptyState message="This merchant has not submitted a public profile for review." isHealthy />
            )}
          </TabsContent>

          <TabsContent value="vouchers">
            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-wrap gap-2">
                  {voucher_templates.map((v) => (
                    <span key={v.id} className={`rounded-full px-3 py-1 text-xs ${v.active ? "bg-primary/10 text-primary" : "bg-surface-subtle text-ink-muted"}`}>
                      {v.title} ({formatNumber(v.miles_cost)} Miles)
                    </span>
                  ))}
                  {voucher_templates.length === 0 && <p className="text-sm text-ink-muted">No templates.</p>}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="team">
            <Card>
              <CardContent className="space-y-1.5 pt-6">
                {team.map((u) => (
                  <div key={u.id} className="flex items-center justify-between text-sm">
                    <div>
                      <p className="font-medium text-ink">{u.name ?? u.email}</p>
                      <p className="text-xs text-ink-muted">{u.email}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{u.role}</Badge>
                      {!u.is_active && <Badge variant="destructive">Inactive</Badge>}
                    </div>
                  </div>
                ))}
                {team.length === 0 && <p className="text-sm text-ink-muted">No team members.</p>}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="notes">
            <Card>
              <CardContent className="space-y-3 pt-6">
                {typedNotes.length === 0 && <p className="text-sm text-ink-muted">No notes yet.</p>}
                {typedNotes.map((note) => (
                  <div key={note.id} className="rounded-card border border-border bg-surface-subtle px-3 py-2.5">
                    <p className="text-sm text-ink">{note.note}</p>
                    <p className="mt-1 text-xs text-ink-muted">
                      {note.admin_users?.name ?? note.admin_users?.email ?? "Unknown"} · {formatDate(note.created_at)}
                    </p>
                  </div>
                ))}
                <AddMerchantNote merchantId={params.id} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history">
            {events.length === 0 ? (
              <EmptyState icon={ScrollText} message="No profile review history for this merchant." isHealthy />
            ) : (
              <ul className="divide-y divide-border rounded-card border border-border bg-surface">
                {events.map((event) => (
                  <li key={event.id} className="px-4 py-3 text-sm">
                    <p className="font-medium text-ink">
                      {event.action.replace(/_/g, " ")}
                      {event.from_status && event.to_status && (
                        <span className="font-normal text-ink-muted"> · {event.from_status} → {event.to_status}</span>
                      )}
                    </p>
                    {(event.merchant_safe_message || event.internal_note) && (
                      <p className="mt-1 text-ink-muted">{event.merchant_safe_message ?? event.internal_note}</p>
                    )}
                    <p className="mt-1 text-xs text-ink-muted">
                      {event.actor_type} · {formatDateTime(event.created_at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
