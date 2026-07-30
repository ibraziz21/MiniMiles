import { createClient } from "@/lib/supabase/server";
import { MemberHome } from "./MemberHome";
import { VisitorLanding } from "./VisitorLanding";

// Auth split — home-redesign-spec.md §5. Same URL, two renders: both get the
// same intent-first discovery shell; members additionally get a
// personalized greeting and the rewards snapshot. No redirect, so there's
// nothing for bookmarks/deep-links to break.
export default async function HomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    return <MemberHome user={user} />;
  }

  return <VisitorLanding />;
}
