import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Commits one of several email-matched legacy `users` addresses as this
 * account's minipay wallet slot, for the WalletPickerModal disambiguation
 * flow (hubProfile.ts auto-links automatically when there is exactly one
 * candidate; this covers the multi-candidate case).
 *
 * Not a signature-proven link — the address must already be one of this
 * user's own email-matched legacy rows, and the resulting row lands as
 * `legacy_unverified` like every other unproven link
 * (production-readiness-security-spec.md §3.4). It cannot authorize any
 * asset/reward operation until the owner separately verifies it via
 * POST /api/me/wallets/challenge + /verify.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !user.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const address = body?.address;
  if (typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }
  const normalized = address.toLowerCase();

  const admin = createAdminClient();

  // The address must be one of this account's own email-matched candidates
  // — never an arbitrary address the client supplies.
  const { data: candidate } = await admin
    .from("users")
    .select("user_address")
    .eq("email", user.email)
    .eq("user_address", normalized)
    .maybeSingle();

  if (!candidate) {
    return NextResponse.json({ error: "Address is not one of your known accounts" }, { status: 403 });
  }

  const { data: existing } = await admin
    .from("hub_user_wallets")
    .select("verification_status")
    .eq("user_id", user.id)
    .eq("ecosystem", "minipay")
    .maybeSingle();

  if (existing?.verification_status === "verified") {
    return NextResponse.json(
      { error: "A verified minipay wallet is already linked — unlink it before switching" },
      { status: 409 }
    );
  }

  const { error } = await admin.from("hub_user_wallets").upsert(
    { user_id: user.id, ecosystem: "minipay", address: normalized, verification_status: "legacy_unverified" },
    { onConflict: "user_id,ecosystem" }
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
