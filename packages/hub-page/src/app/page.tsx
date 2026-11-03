import { createClient } from "@/lib/supabase/server";
import { MemberHome } from "./MemberHome";
import { VisitorLanding } from "./VisitorLanding";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { needsWebOnboarding } from "@/lib/akiba/webOnboarding";

// Auth split — home-redesign-spec.md §5. Same URL, two renders: both get the
// same intent-first discovery shell; members additionally get a
// personalized greeting and the rewards snapshot. Future Pass holders
// finish first-run onboarding before their first member-home visit.
export default async function HomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    const { data, error } = await createAdminClient().from("hub_user_passes")
      .select("onboarding_required, onboarding_seen_at").eq("user_id", user.id).maybeSingle();
    if (error) throw new Error("Could not load your signup progress. Please try again.");
    if (needsWebOnboarding(data)) redirect("/welcome");
    return <MemberHome user={user} />;
  }

  return <VisitorLanding />;
}
