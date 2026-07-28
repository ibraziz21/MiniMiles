// merchant-ux-spec.md §4 Issued — individual vouchers distributed to customers.
import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { redirect } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { VoucherTabs } from "@/components/vouchers/VoucherTabs";
import { channelLabel } from "@/lib/voucherChannels";

const STATUS_STYLES: Record<string, string> = {
  issued: "bg-blue-100 text-blue-700",
  redeemed: "bg-green-100 text-green-700",
  expired: "bg-gray-100 text-gray-500",
  void: "bg-red-100 text-red-600",
};

interface IssuedRow {
  id: string;
  status: string;
  acquisition_source: string;
  created_at: string;
  expires_at: string | null;
  redeemed_at: string | null;
  rules_snapshot: { title?: string } | null;
}

export default async function IssuedVouchersPage() {
  const session = await requireMerchantSession();
  if (!session) redirect("/login");

  const { data } = await supabase
    .from("issued_vouchers")
    .select("id,status,acquisition_source,created_at,expires_at,redeemed_at,rules_snapshot")
    .eq("merchant_id", session.partnerId)
    .order("created_at", { ascending: false })
    .limit(200);

  const rows = (data ?? []) as IssuedRow[];

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TopBar title="Vouchers" subtitle={`${rows.length} issued (most recent 200)`} />
      <VoucherTabs />
      <div className="flex-1 overflow-y-auto p-6">
        <Card>
          <CardContent className="p-0">
            {rows.length === 0 ? (
              <div className="py-16 text-center text-sm text-gray-500">No vouchers have been issued yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                      <th className="px-5 py-3">Voucher</th>
                      <th className="px-5 py-3">Acquisition source</th>
                      <th className="px-5 py-3">Status</th>
                      <th className="px-5 py-3">Issued</th>
                      <th className="px-5 py-3">Expires</th>
                      <th className="px-5 py-3">Redeemed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {rows.map((r) => (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="px-5 py-3 font-medium text-gray-900">{r.rules_snapshot?.title ?? "—"}</td>
                        <td className="px-5 py-3 text-gray-600">{channelLabel(r.acquisition_source)}</td>
                        <td className="px-5 py-3"><Badge className={STATUS_STYLES[r.status] ?? "bg-gray-100 text-gray-500"}>{r.status}</Badge></td>
                        <td className="px-5 py-3 text-xs text-gray-500">{new Date(r.created_at).toLocaleString("en-KE")}</td>
                        <td className="px-5 py-3 text-xs text-gray-500">{r.expires_at ? new Date(r.expires_at).toLocaleDateString() : "—"}</td>
                        <td className="px-5 py-3 text-xs text-gray-500">{r.redeemed_at ? new Date(r.redeemed_at).toLocaleString("en-KE") : "—"}</td>
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
