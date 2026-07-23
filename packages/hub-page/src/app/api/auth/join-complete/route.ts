/**
 * POST /api/auth/join-complete
 * Body: { src?: string }
 *
 * Called right after OTP verification on the /join fast path. Creates (or
 * fetches) the user's pass and persists the acquisition src — but does NOT
 * mark onboarding as seen: the fast path skips the carousel *this once*,
 * /welcome is still offered on the next visit (home-redesign-spec.md §6).
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveHubProfile } from "@/lib/akiba/hubProfile";
import { getOrCreatePass } from "@/lib/akiba/pass";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { src?: unknown };
  const src = typeof body.src === "string" ? body.src.slice(0, 100) : null;

  const { walletAddress } = await resolveHubProfile({ userId: user.id, email: user.email ?? null });
  const { publicPassId } = await getOrCreatePass({
    userId: user.id,
    email: user.email ?? null,
    walletAddress,
  });

  if (!publicPassId) {
    return NextResponse.json({ error: "Could not create pass" }, { status: 500 });
  }

  if (src) {
    const admin = createAdminClient();
    await admin.from("hub_user_passes").update({ signup_src: src }).eq("user_id", user.id);
  }

  return NextResponse.json({ publicPassId });
}
