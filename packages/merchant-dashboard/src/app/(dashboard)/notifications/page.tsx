import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { redirect } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { formatDate } from "@/lib/utils";
import type { NotificationLogEntry } from "@/types";

const TYPE_LABELS: Record<string, string> = {
  new_order: "New Order",
  stale_order: "Stale Order",
  out_for_delivery_followup: "Delivery Follow-up",
};

const TYPE_BADGE_CLASSES: Record<string, string> = {
  new_order: "bg-emerald-100 text-emerald-700",
  stale_order: "bg-amber-100 text-amber-800",
  out_for_delivery_followup: "bg-slate-100 text-slate-700",
};

export default async function NotificationsPage() {
  const session = await requireMerchantSession();
  if (!session) redirect("/login");

  const { data: notifications } = await supabase
    .from("merchant_notification_log")
    .select("id,type,order_id,subject,body_preview,sent_at")
    .eq("partner_id", session.partnerId)
    .order("sent_at", { ascending: false })
    .limit(50);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TopBar title="Notifications" subtitle="History of all sent notifications" />
      <div className="flex-1 overflow-y-auto p-6">
        <Card>
          <CardContent className="p-0">
            {(notifications ?? []).length === 0 ? (
              <div className="py-16 text-center text-sm text-gray-500">No notifications sent yet.</div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {(notifications as NotificationLogEntry[]).map((n) => (
                  <li key={n.id} className="flex items-start gap-4 px-5 py-4 hover:bg-gray-50">
                    <Badge className={`mt-0.5 shrink-0 ${TYPE_BADGE_CLASSES[n.type] ?? "bg-slate-100 text-slate-700"}`}>
                      {TYPE_LABELS[n.type] ?? n.type}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 truncate">{n.subject ?? "—"}</p>
                      {n.body_preview && (
                        <p className="text-xs text-gray-500 mt-0.5 truncate">{n.body_preview}</p>
                      )}
                      {n.order_id && (
                        <Link href={`/orders/${n.order_id}`} className="text-xs text-[#238D9D] hover:underline mt-0.5 inline-block">
                          View order →
                        </Link>
                      )}
                    </div>
                    <span className="shrink-0 text-xs text-gray-400">{formatDate(n.sent_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
