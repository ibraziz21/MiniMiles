import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getReferralDashboard } from "@/lib/akiba/referralDashboard";
import { ReferralsPageClient } from "./ReferralsPageClient";

// /referrals — referral-system-spec.md §9.2. Fetches the same dashboard
// data as GET /api/referrals/me directly (no self-fetch) so first paint
// doesn't wait on a round trip to its own API route.
export const metadata = { title: "Invite friends — Akiba Pass" };

export default async function ReferralsPage() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/login?next=/referrals");

  // A dashboard-query failure must not strand the member without their
  // invite link (§9.4 "server failures preserve the invite link and show
  // retryable, non-destructive states") — the link itself only needs the
  // stable referral code, not the full dashboard query.
  let dashboard;
  try {
    dashboard = await getReferralDashboard(user.id);
  } catch (err) {
    console.error("[referrals] getReferralDashboard failed:", err);
    return (
      <main className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-md flex-col items-center justify-center px-6 py-8 text-center">
        <h1 className="font-sterling text-2xl font-semibold text-akiba-ink">
          Referrals are temporarily unavailable
        </h1>
        <p className="mt-2 text-sm text-akiba-muted">
          We couldn&apos;t load your referral details. Your account and any pending Miles are safe — please try again.
        </p>
        <form action="/referrals" method="get" className="mt-5">
          <button
            type="submit"
            className="rounded-full bg-akiba-teal px-5 py-2.5 text-sm font-semibold text-white"
          >
            Try again
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 pt-4 pb-8 sm:pt-8">
      <ReferralsPageClient dashboard={dashboard} />
    </main>
  );
}
