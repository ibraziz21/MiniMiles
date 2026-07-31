import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildIdentities } from "@/lib/akiba/identities";

const MINIPOINTS = process.env.MINIPOINTS_ADDRESS;
const CELO_RPC = process.env.CELO_RPC_URL ?? "https://forno.celo.org";

async function readBalance(address: string): Promise<number> {
  if (!MINIPOINTS) return 0;
  try {
    const data =
      "0x70a08231" + address.replace("0x", "").toLowerCase().padStart(64, "0");
    const res = await fetch(CELO_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1,
        method: "eth_call",
        params: [{ to: MINIPOINTS, data }, "latest"],
      }),
    });
    const json = await res.json();
    if (!json.result || json.result === "0x") return 0;
    return Number(BigInt(json.result) / BigInt(1e18));
  } catch {
    return 0;
  }
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  const { data: userRow } = await admin
    .from("users")
    .select("user_address, username, full_name, avatar_url, country, interests, is_member")
    .eq("email", user.email!)
    .maybeSingle();

  const walletAddress = userRow?.user_address ?? null;
  const akibaMiles = walletAddress ? await readBalance(walletAddress) : 0;

  return NextResponse.json({
    email: user.email,
    wallet_address: walletAddress,
    akiba_miles: akibaMiles,
    profile: userRow
      ? {
          username: userRow.username,
          full_name: userRow.full_name,
          avatar_url: userRow.avatar_url,
          country: userRow.country,
          interests: userRow.interests ?? [],
          is_member: userRow.is_member,
        }
      : null,
  });
}

// PATCH { country } — Hub-native profile edit, keyed by hub_user_profiles
// (not the legacy wallet-row `users.country`). Wires profile_country_set
// (merchant-shopping-quests-spec.md §5 "Country") via the atomic
// set_hub_profile_country RPC, which only enqueues the event on a genuine
// no-country -> valid-country transition.
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const country = body?.country;
  if (typeof country !== "string" || country.trim().length === 0) {
    return NextResponse.json({ error: "country is required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const identities = await buildIdentities({ userId: user.id, email: user.email ?? null });

  const { error } = await admin.rpc("set_hub_profile_country", {
    p_user_id: user.id,
    p_identities: identities,
    p_country: country.trim(),
  });
  if (error) {
    console.error("[api/me PATCH] set_hub_profile_country failed:", error.message);
    return NextResponse.json({ error: "Could not update profile" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, country: country.trim() });
}
