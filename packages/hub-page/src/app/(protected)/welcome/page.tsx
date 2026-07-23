import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveHubProfile } from "@/lib/akiba/hubProfile";
import { getOrCreatePass } from "@/lib/akiba/pass";
import { WelcomeCarousel } from "./WelcomeCarousel";

// Onboarding carousel — home-redesign-spec.md §5. Shown once after first
// signup, skippable, never re-shown after skip (checked via
// hub_user_passes.onboarding_seen_at). Ends by handing the user their real
// QR — the thing the whole flow promised.
export const metadata = { title: "Welcome — Akiba Pass" };

export default async function WelcomePage() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/login?next=/welcome");

  const { walletAddress, displayName } = await resolveHubProfile({
    userId: user.id,
    email: user.email ?? null,
  });
  const { publicPassId } = await getOrCreatePass({
    userId: user.id,
    email: user.email ?? null,
    walletAddress,
  });

  const admin = createAdminClient();
  const { data: passRow } = await admin
    .from("hub_user_passes")
    .select("onboarding_seen_at")
    .eq("user_id", user.id)
    .maybeSingle();

  // Already seen (or skipped) — never show again. Also nothing to reveal
  // without an email-backed pass, so skip straight through either way.
  if (passRow?.onboarding_seen_at || !publicPassId || !user.email) {
    redirect("/");
  }

  return (
    <WelcomeCarousel passId={publicPassId} email={user.email} displayLabel={displayName} />
  );
}
