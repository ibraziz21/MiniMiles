import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveHubProfile } from "@/lib/akiba/hubProfile";
import { resolveHubQuestCanonical } from "@/lib/akiba/canonicalPartnerQuests";
import { getOrCreatePass } from "@/lib/akiba/pass";
import { onboardingReturnPath } from "@/lib/akiba/webOnboarding";
import { WelcomeCarousel } from "./WelcomeCarousel";

export const metadata = { title: "Welcome — Akiba Pass" };

export default async function WelcomePage({ searchParams }: { searchParams: { next?: string } }) {
  const next = onboardingReturnPath(searchParams.next);
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect(`/login?next=${encodeURIComponent(next)}`);

  const [{ walletAddress, displayName, activeRow }, canonicalId] = await Promise.all([
    resolveHubProfile({ userId: user.id, email: user.email ?? null }),
    resolveHubQuestCanonical({ hubUserId: user.id, email: user.email ?? null }),
  ]);
  const { publicPassId } = await getOrCreatePass({ userId: user.id, email: user.email ?? null, walletAddress });
  if (!publicPassId || !user.email) throw new Error("Could not prepare your Pass. Please try again.");

  const admin = createAdminClient();
  const [pass, profile, leaderboard] = await Promise.all([
    admin.from("hub_user_passes").select("onboarding_seen_at").eq("user_id", user.id).maybeSingle(),
    admin.from("hub_user_profiles").select("country, city").eq("user_id", user.id).maybeSingle(),
    admin.from("leaderboard_profiles").select("username").eq("canonical_id", canonicalId).maybeSingle(),
  ]);
  if (pass.error || profile.error || leaderboard.error) throw new Error("Could not load your profile. Please try again.");
  if (pass.data?.onboarding_seen_at) redirect(next);

  return <WelcomeCarousel
    userId={user.id} passId={publicPassId} displayLabel={displayName} next={next}
    username={leaderboard.data?.username ?? activeRow?.username ?? ""}
    country={profile.data?.country ?? activeRow?.country ?? ""} city={profile.data?.city ?? ""}
  />;
}
