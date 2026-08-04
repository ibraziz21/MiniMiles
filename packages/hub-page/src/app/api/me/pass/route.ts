/**
 * GET /api/me/pass
 *
 * Returns the authenticated Hub user's stable Akiba Pass identifier.
 * Creates the pass row on first call (idempotent).
 *
 * The returned publicPassId is a stable UUID — it does not expire.
 * The qrPayload is the string to encode in the QR canvas.
 *
 * Used by AkibaPassCard on the /me profile page.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrCreatePass } from "@/lib/akiba/pass";
import { REFERRAL_COOKIE_NAME } from "@/lib/akiba/referral-token";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!user.email) {
    return NextResponse.json({ error: "Account has no email — cannot issue pass" }, { status: 422 });
  }

  // Delegates to the same atomic create-or-get path /pass, /welcome, /me and
  // join-complete use — this route used to duplicate the insert+emit logic
  // independently, which meant a user hitting this route first (rather than
  // /me) got a pass_activated outbox row from a second, parallel code path.
  const { publicPassId } = await getOrCreatePass({
    userId: user.id,
    email: user.email,
    walletAddress: null,
  });

  if (!publicPassId) {
    return NextResponse.json({ error: "Could not issue pass" }, { status: 500 });
  }

  const res = NextResponse.json({
    publicPassId,
    qrPayload: `akiba-pass:v1:${publicPassId}`,
  });
  // Always clear — see join-complete/route.ts for why isNew=false (Pass
  // already existed) must clear it too, not just a fresh bind.
  res.cookies.delete(REFERRAL_COOKIE_NAME);
  return res;
}
