// GET /api/me/discovery-contributions/next
// Returns the caller's oldest open, unexpired visit-card contribution
// request (verified-discovery-acquisition-v1-spec.md §11.2), or null when
// there is nothing pending. Shares its query/prompt-marking logic with the
// Hub home pending-contribution nudge via getNextDiscoveryContributionRequest.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getNextDiscoveryContributionRequest } from "@/lib/akiba/discoveryContributions";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const request = await getNextDiscoveryContributionRequest(user.id);
  return NextResponse.json({ request });
}
