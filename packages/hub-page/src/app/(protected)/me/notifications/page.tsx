import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ArrowLeft, Bell, Package, Truck, CheckCircle2, XCircle, RotateCcw, Ticket, AlertTriangle, Gift, Sparkles, Store } from "lucide-react";
import { PushNotificationSettings } from "@/components/PushNotificationSettings";

export const metadata = { title: "Notifications — Akiba Pass" };

const TEMPLATE_CONFIG: Record<string, { label: string; icon: React.ReactNode }> = {
  order_placed:           { label: "Order placed",             icon: <Package className="h-4 w-4" /> },
  order_accepted:         { label: "Order accepted",            icon: <Package className="h-4 w-4" /> },
  order_dispatched:       { label: "Order dispatched",          icon: <Truck className="h-4 w-4" /> },
  order_delivered:        { label: "Order delivered",           icon: <CheckCircle2 className="h-4 w-4" /> },
  digital_delivered:      { label: "Digital delivery ready",     icon: <CheckCircle2 className="h-4 w-4" /> },
  order_cancelled:        { label: "Order cancelled",           icon: <XCircle className="h-4 w-4" /> },
  refund_initiated:       { label: "Refund initiated",          icon: <RotateCcw className="h-4 w-4" /> },
  refund_completed:       { label: "Refund completed",          icon: <RotateCcw className="h-4 w-4" /> },
  voucher_ready:          { label: "Voucher ready",             icon: <Ticket className="h-4 w-4" /> },
  voucher_failed:         { label: "Voucher purchase failed",   icon: <XCircle className="h-4 w-4" /> },
  voucher_reconciliation: { label: "Voucher purchase in review", icon: <AlertTriangle className="h-4 w-4" /> },
  referral_signup_held:        { label: "Friend joined — Miles pending",   icon: <Gift className="h-4 w-4" /> },
  referral_signup_released:    { label: "Referral Miles earned",           icon: <Gift className="h-4 w-4" /> },
  referral_activation_held:    { label: "Friend became active — Miles pending", icon: <Gift className="h-4 w-4" /> },
  referral_activation_released:{ label: "Referral complete",               icon: <Gift className="h-4 w-4" /> },
  referral_manual_review:      { label: "Referral reward under review",    icon: <AlertTriangle className="h-4 w-4" /> },
  feature_announcement:        { label: "Akiba feature update",            icon: <Sparkles className="h-4 w-4" /> },
  merchant_announcement:       { label: "New Akiba merchant",              icon: <Store className="h-4 w-4" /> },
  general_announcement:        { label: "Akiba update",                    icon: <Bell className="h-4 w-4" /> },
};

type NotificationRow = {
  id: string;
  order_id: string | null;
  template: string;
  created_at: string;
  metadata: Record<string, unknown>;
  deep_link: string | null;
};

async function getNotifications(userId: string, email: string | null): Promise<NotificationRow[]> {
  const admin = createAdminClient();

  const { data: walletRows } = await admin
    .from("hub_user_wallets")
    .select("address")
    .eq("user_id", userId);

  const refs = [
    ...(walletRows ?? []).map((r: { address: string }) => r.address),
    ...(email ? [email] : []),
    userId,
  ];

  const { data } = await admin
    .from("notification_outbox")
    .select("id, order_id, template, created_at, metadata, deep_link")
    .in("user_ref", refs)
    .order("created_at", { ascending: false })
    .limit(50);

  return (data ?? []) as NotificationRow[];
}

export default async function NotificationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/me/notifications");

  const notifications = await getNotifications(user.id, user.email ?? null);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <a href="/me" className="mb-6 flex items-center gap-1.5 text-sm text-akiba-muted hover:text-akiba-ink">
        <ArrowLeft className="h-4 w-4" /> My profile
      </a>

      <h1 className="mb-6 font-sterling text-2xl font-semibold text-akiba-ink">Notifications</h1>

      <div className="mb-6">
        <PushNotificationSettings />
      </div>

      {notifications.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-akiba-line bg-white py-14 text-center">
          <Bell className="mb-3 h-10 w-10 text-akiba-line" />
          <p className="font-medium text-akiba-ink">No notifications yet</p>
          <p className="mt-1 text-sm text-akiba-muted">Order updates will show up here.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => {
            const cfg = TEMPLATE_CONFIG[n.template] ?? { label: n.template, icon: <Bell className="h-4 w-4" /> };
            const announcementTitle =
              n.template.endsWith("_announcement") && typeof n.metadata.title === "string"
                ? n.metadata.title
                : null;
            const announcementBody =
              n.template.endsWith("_announcement") && typeof n.metadata.body === "string"
                ? n.metadata.body
                : null;
            return (
              <div key={n.id} className="flex items-start gap-3 rounded-2xl border border-akiba-line bg-white p-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-akiba-tint text-akiba-teal">
                  {cfg.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-akiba-ink">{announcementTitle ?? cfg.label}</p>
                  {announcementBody && <p className="mt-0.5 text-sm text-akiba-muted">{announcementBody}</p>}
                  {n.order_id ? (
                    <a href="/me/orders" className="text-xs text-akiba-teal hover:underline">
                      View order
                    </a>
                  ) : n.deep_link ? (
                    <a href={n.deep_link} className="text-xs text-akiba-teal hover:underline">
                      View details
                    </a>
                  ) : null}
                  <p className="mt-0.5 text-xs text-akiba-muted">
                    {new Date(n.created_at).toLocaleString("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
