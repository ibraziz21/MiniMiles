import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatNumber } from "@/lib/utils";
import { AddMerchantNote } from "@/components/merchants/AddMerchantNote";
import { ArrowLeft, ShieldCheck } from "lucide-react";

async function getMerchantDetail(id: string) {
  const [partnerRes, settingsRes, subscriptionRes, vouchersRes, teamRes, notesRes] = await Promise.all([
    supabase.from("partners").select("*").eq("id", id).single(),
    supabase.from("partner_settings").select("directory_status").eq("partner_id", id).maybeSingle(),
    supabase
      .from("partner_subscriptions")
      .select("plan,status,billing_period,included_monthly_miles,miles_issued_current_period,overage_miles_current_period,next_renewal_at")
      .eq("partner_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("spend_voucher_templates").select("id, title, active, lifecycle_state, miles_cost").eq("partner_id", id),
    supabase.from("merchant_users").select("id, email, name, role, is_active").eq("partner_id", id),
    supabase.from("merchant_admin_notes").select("id, note, created_at, admin_users(name, email)").eq("partner_id", id).order("created_at", { ascending: false }),
  ]);

  if (!partnerRes.data) return null;

  return {
    partner: partnerRes.data,
    settings: settingsRes.data ?? null,
    subscription: subscriptionRes.data ?? null,
    voucher_templates: vouchersRes.data ?? [],
    team: teamRes.data ?? [],
    notes: notesRes.data ?? [],
  };
}

export default async function MerchantDetailPage({ params }: { params: { id: string } }) {
  const session = await requireAdminSession("merchants.read");
  if (!session) redirect("/login");

  const detail = await getMerchantDetail(params.id);
  if (!detail) notFound();

  const { partner, settings, subscription, voucher_templates, team, notes } = detail;
  const activeVoucherTypes = voucher_templates.filter(
    (voucher) => voucher.lifecycle_state === "published" && voucher.active,
  ).length;

  return (
    <div>
      <TopBar title={partner.name} subtitle="Merchant detail" />
      <div className="p-6 space-y-6">
        <Link href="/merchants" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to merchants
        </Link>

        {settings?.directory_status && (
          <Link
            href={`/directory-reviews/${params.id}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#238D9D]/30 bg-[#238D9D]/5 px-3 py-2 text-sm font-medium text-[#176B78] hover:bg-[#238D9D]/10"
          >
            <ShieldCheck className="h-4 w-4" />
            Review public profile · {String(settings.directory_status).replaceAll("_", " ")}
          </Link>
        )}

        {/* Subscription and account summary */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-slate-500">Subscription</CardTitle></CardHeader>
            <CardContent>
              {subscription ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-2xl font-bold capitalize">{subscription.plan}</span>
                  <Badge variant={subscription.status === "active" ? "success" : subscription.status === "suspended" ? "destructive" : "secondary"}>
                    {subscription.status.replaceAll("_", " ")}
                  </Badge>
                </div>
              ) : (
                <Badge variant="outline">No subscription</Badge>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-slate-500">Active Voucher Types</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">{formatNumber(activeVoucherTypes)}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-slate-500">Team Members</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">{team.length}</p></CardContent>
          </Card>
        </div>

        {subscription && (
          <Card>
            <CardHeader><CardTitle>Plan Usage</CardTitle></CardHeader>
            <CardContent className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div><p className="text-xs text-slate-400">Billing term</p><p className="mt-1 font-medium capitalize">{subscription.billing_period ?? "—"}</p></div>
              <div><p className="text-xs text-slate-400">Miles issued this month</p><p className="mt-1 font-medium">{formatNumber(subscription.miles_issued_current_period ?? 0)} / {formatNumber(subscription.included_monthly_miles ?? 0)}</p></div>
              <div><p className="text-xs text-slate-400">Overage Miles</p><p className="mt-1 font-medium">{formatNumber(subscription.overage_miles_current_period ?? 0)}</p></div>
              <div><p className="text-xs text-slate-400">Next renewal</p><p className="mt-1 font-medium">{subscription.next_renewal_at ? formatDate(subscription.next_renewal_at) : "—"}</p></div>
            </CardContent>
          </Card>
        )}

        {/* Voucher templates */}
        <Card>
          <CardHeader><CardTitle>Voucher Templates ({voucher_templates.length})</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {voucher_templates.map((v) => (
                <span key={v.id} className={`rounded-full px-3 py-1 text-xs ${v.active ? "bg-[#238D9D]/10 text-[#238D9D]" : "bg-slate-100 text-slate-500"}`}>
                  {v.title} ({formatNumber(v.miles_cost)} Miles)
                </span>
              ))}
              {voucher_templates.length === 0 && <p className="text-sm text-slate-400">No templates.</p>}
            </div>
          </CardContent>
        </Card>

        {/* Team */}
        <Card>
          <CardHeader><CardTitle>Team</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {team.map((u) => (
                <div key={u.id} className="flex items-center justify-between text-sm">
                  <div>
                    <p className="font-medium text-slate-900">{u.name ?? u.email}</p>
                    <p className="text-xs text-slate-400">{u.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{u.role}</Badge>
                    {!u.is_active && <Badge variant="destructive">Inactive</Badge>}
                  </div>
                </div>
              ))}
              {team.length === 0 && <p className="text-sm text-slate-400">No team members.</p>}
            </div>
          </CardContent>
        </Card>

        {/* Internal notes */}
        <Card>
          <CardHeader><CardTitle>Internal Notes</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {notes.length === 0 && <p className="text-sm text-slate-400">No notes yet.</p>}
            {(notes as unknown as Array<{ id: string; note: string; created_at: string; admin_users?: { name: string | null; email: string } | null }>).map((note) => (
              <div key={note.id} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5">
                <p className="text-sm text-slate-700">{note.note}</p>
                <p className="mt-1 text-xs text-slate-400">{note.admin_users?.name ?? note.admin_users?.email ?? "Unknown"} · {formatDate(note.created_at)}</p>
              </div>
            ))}
            <AddMerchantNote merchantId={params.id} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
