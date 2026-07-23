import { createClient } from "@/lib/supabase/server";
import { getFeaturedMerchants } from "@/lib/akiba/featuredMerchants";
import { MemberHome } from "./MemberHome";
import { VisitorLanding } from "./VisitorLanding";

// Auth split — home-redesign-spec.md §1. Same URL, two renders: members get
// a tool (MemberHome), visitors get a slim pitch (VisitorLanding). No
// redirect, so there's nothing for bookmarks/deep-links to break.
export default async function HomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    return <MemberHome user={user} />;
  }

  const merchants = await getFeaturedMerchants();
  return <VisitorLanding merchants={merchants} />;
}
