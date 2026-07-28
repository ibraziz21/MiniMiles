// merchant-ux-spec.md §4 Overview — summary metrics, recent activity, and
// primary actions. §13: metrics we can't compute yet render as "—" rather
// than being estimated.
import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus, QrCode } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { VoucherTabs } from "@/components/vouchers/VoucherTabs";
import { channelLabel } from "@/lib/voucherChannels";

export default async function VouchersOverviewPage() {
  const session = await requireMerchantSession();
  if (!session) redirect("/login");
  const canEdit = ["owner", "manager"].includes(session.role);

  const { data: templateRows } = await supabase
    .from("spend_voucher_templates")
    .select("id")
    .eq("partner_id", session.partnerId);
  const templateIds = (templateRows ?? []).map((t) => t.id);

  const { data: inventoryRows } = templateIds.length
    ? await supabase
        .from("v_program_inventory")
        .select("program_id,state,channel,channel_consumed")
        .in("template_id", templateIds)
    : { data: [] as { program_id: string; state: string; channel: string | null; channel_consumed: number }[] };

  const rows = inventoryRows ?? [];
  const programIds = new Set(rows.map((r) => r.program_id));
  const liveCount = new Set(rows.filter((r) => r.state === "active").map((r) => r.program_id)).size;

  const distributedByChannel = new Map<string, number>();
  for (const r of rows) {
    if (!r.channel) continue;
    distributedByChannel.set(r.channel, (distributedByChannel.get(r.channel) ?? 0) + (r.channel_consumed ?? 0));
  }

  const { data: issuedRows } = programIds.size
    ? await supabase.from("issued_vouchers").select("status").in("program_id", [...programIds])
    : { data: [] as { status: string }[] };
  const totalDistributed = (issuedRows ?? []).length;
  const totalRedeemed = (issuedRows ?? []).filter((r) => r.status === "redeemed").length;
  const redemptionRate = totalDistributed > 0 ? `${Math.round((totalRedeemed / totalDistributed) * 100)}%` : "—";

  const { data: recentActivity } = await supabase
    .from("merchant_audit_log")
    .select("id,action,created_at")
    .eq("partner_id", session.partnerId)
    .or("action.ilike.program.%,action.ilike.voucher_template.%")
    .order("created_at", { ascending: false })
    .limit(10);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TopBar
        title="Vouchers"
        subtitle="Overview"
        actions={
          <div className="flex gap-2">
            <Link href="/vouchers/redeem"><Button variant="outline" size="sm" className="gap-1.5"><QrCode className="h-4 w-4" /> Redeem voucher</Button></Link>
            {canEdit && <Link href="/vouchers/create"><Button size="sm" className="gap-1.5"><Plus className="h-4 w-4" /> Create voucher</Button></Link>}
          </div>
        }
      />
      <VoucherTabs />
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        <div className="grid grid-cols-4 gap-4">
          <Stat label="Vouchers created" value={templateIds.length} />
          <Stat label="Live distributions" value={liveCount} />
          <Stat label="Distributed" value={totalDistributed} />
          <Stat label="Redemption rate" value={redemptionRate} />
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Distributed by channel</CardTitle></CardHeader>
          <CardContent>
            {distributedByChannel.size === 0 ? (
              <p className="text-sm text-gray-400">No distribution activity yet.</p>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {[...distributedByChannel.entries()].map(([channel, count]) => (
                  <div key={channel} className="rounded-lg border border-gray-100 p-3">
                    <p className="text-xs text-gray-400">{channelLabel(channel)}</p>
                    <p className="mt-1 text-lg font-semibold text-gray-900">{count}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Recent activity</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(recentActivity ?? []).length === 0 ? (
              <p className="text-sm text-gray-400">No activity yet.</p>
            ) : (
              (recentActivity ?? []).map((a) => (
                <div key={a.id} className="flex items-center gap-3 text-xs">
                  <span className="shrink-0 text-gray-400">{new Date(a.created_at).toLocaleString("en-KE")}</span>
                  <span className="font-medium capitalize text-gray-700">{a.action.replace(/\./g, " · ")}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-gray-400">{label}</p>
        <p className="mt-1 text-xl font-semibold text-gray-900">{value}</p>
      </CardContent>
    </Card>
  );
}
