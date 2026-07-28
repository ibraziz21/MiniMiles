// merchant-ux-spec.md §4 Redemptions — redemption history (the scan/redeem
// entry point stays a separate primary action at /vouchers/redeem, spec §4).
import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { redirect } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { VoucherTabs } from "@/components/vouchers/VoucherTabs";

const CHANNEL_STYLES: Record<string, string> = {
  online_order: "bg-blue-100 text-blue-700",
  merchant_scan: "bg-purple-100 text-purple-700",
};

const CHANNEL_LABELS: Record<string, string> = {
  online_order: "Hub checkout",
  merchant_scan: "In-store scan",
};

interface RedemptionRow {
  id: string;
  discount_applied: number;
  redemption_channel: string;
  redeemed_at: string;
  issued_voucher_id: string;
}

export default async function RedemptionsPage() {
  const session = await requireMerchantSession();
  if (!session) redirect("/login");

  const { data } = await supabase
    .from("voucher_redemptions")
    .select("id,discount_applied,redemption_channel,redeemed_at,issued_voucher_id")
    .eq("merchant_id", session.partnerId)
    .order("redeemed_at", { ascending: false })
    .limit(200);

  const rows = (data ?? []) as RedemptionRow[];

  const voucherIds = rows.map((r) => r.issued_voucher_id);
  const { data: vouchers } = voucherIds.length
    ? await supabase.from("issued_vouchers").select("id,rules_snapshot").in("id", voucherIds)
    : { data: [] as { id: string; rules_snapshot: { title?: string } | null }[] };
  const titleById = new Map((vouchers ?? []).map((v) => [v.id, v.rules_snapshot?.title ?? "—"]));

  const totalValue = rows.reduce((sum, r) => sum + Number(r.discount_applied), 0);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TopBar title="Vouchers" subtitle={`${rows.length} redemptions (most recent 200) · $${totalValue.toFixed(2)} redemption value`} />
      <VoucherTabs />
      <div className="flex-1 overflow-y-auto p-6">
        <Card>
          <CardContent className="p-0">
            {rows.length === 0 ? (
              <div className="py-16 text-center text-sm text-gray-500">No redemptions yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                      <th className="px-5 py-3">Voucher</th>
                      <th className="px-5 py-3">Channel</th>
                      <th className="px-5 py-3">Discount applied</th>
                      <th className="px-5 py-3">Redeemed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {rows.map((r) => (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="px-5 py-3 font-medium text-gray-900">{titleById.get(r.issued_voucher_id) ?? "—"}</td>
                        <td className="px-5 py-3"><Badge className={CHANNEL_STYLES[r.redemption_channel] ?? "bg-gray-100 text-gray-500"}>{CHANNEL_LABELS[r.redemption_channel] ?? r.redemption_channel}</Badge></td>
                        <td className="px-5 py-3 text-gray-700">${Number(r.discount_applied).toFixed(2)}</td>
                        <td className="px-5 py-3 text-xs text-gray-500">{new Date(r.redeemed_at).toLocaleString("en-KE")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
