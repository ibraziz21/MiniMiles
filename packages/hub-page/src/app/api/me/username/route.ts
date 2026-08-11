import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveHubQuestCanonical } from "@/lib/akiba/canonicalPartnerQuests";

// GET  /api/me/username   — current public leaderboard @username, if claimed.
// PATCH /api/me/username { username } — claim or change it. Validation and
// the 30-day cooldown are enforced server-side by set_leaderboard_username
// (skill-games-leaderboards-spec.md §4.3) — this route only resolves the
// caller's canonical id and forwards the typed error_code.
const ERROR_MESSAGES: Record<string, string> = {
  "canonical-required": "Could not resolve your account.",
  "invalid-format": "Usernames are 3-20 lowercase letters, numbers, or underscores.",
  "reserved-name": "That username is reserved.",
  "already-taken": "That username is already taken.",
  "cooldown-active": "You can change your username again 30 days after your last change.",
  "rate-limited": "Too many attempts — try again in a bit.",
};

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const canonicalId = await resolveHubQuestCanonical({ hubUserId: user.id, email: user.email ?? null });
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("leaderboard_profiles")
    .select("username, changed_at")
    .eq("canonical_id", canonicalId)
    .maybeSingle();

  return NextResponse.json({
    username: profile?.username ?? null,
    changedAt: profile?.changed_at ?? null,
  });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const username = body?.username;
  if (typeof username !== "string" || username.trim().length === 0) {
    return NextResponse.json({ error: "username is required" }, { status: 400 });
  }

  const canonicalId = await resolveHubQuestCanonical({ hubUserId: user.id, email: user.email ?? null });
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("set_leaderboard_username", {
    p_canonical_id: canonicalId,
    p_username: username.trim().toLowerCase(),
  });
  if (error) {
    console.error("[api/me/username PATCH] set_leaderboard_username failed:", error.message);
    return NextResponse.json({ error: "Could not update username" }, { status: 500 });
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.ok) {
    const code = row?.error_code ?? "unknown";
    return NextResponse.json(
      { error: ERROR_MESSAGES[code] ?? "Could not update username", code },
      { status: 422 }
    );
  }

  return NextResponse.json({ ok: true, username: row.username, changedAt: row.changed_at });
}
