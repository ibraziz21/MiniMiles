import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRecentActivity } from "@/lib/akiba/activity";
import { ActivityFeed } from "../ActivityFeed";
import { ArrowLeft } from "lucide-react";

export const metadata = { title: "Activity — Akiba Hub" };

export default async function ActivityPage() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/login?next=/me/activity");

  const admin = createAdminClient();
  const { data: savedWallet } = await admin
    .from("hub_user_wallets")
    .select("address")
    .eq("user_id", user.id)
    .eq("ecosystem", "minipay")
    .maybeSingle();

  const activity = await getRecentActivity({
    userId: user.id,
    walletAddress: savedWallet?.address ?? null,
    limit: 50,
  });

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 sm:py-10">
      <a
        href="/me"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-akiba-muted transition hover:text-akiba-ink"
      >
        <ArrowLeft className="h-4 w-4" /> Back to profile
      </a>
      <h1 className="mb-4 font-sterling text-2xl font-semibold text-akiba-ink">
        Activity
      </h1>
      <ActivityFeed items={activity} />
    </main>
  );
}
