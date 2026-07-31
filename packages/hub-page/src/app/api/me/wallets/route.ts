import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Direct linking (POST) was removed in favor of the two-step verified flow
// (production-readiness-security-spec.md §3.2): POST /api/me/wallets/challenge
// then POST /api/me/wallets/verify. A bare address here was never proof of
// ownership. See src/app/(protected)/me/WalletSection.tsx for the client
// flow that signs the challenge.

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("hub_user_wallets")
    .select("ecosystem, address, is_primary, linked_at, verification_status")
    .eq("user_id", user.id)
    .order("linked_at");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
