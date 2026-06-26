import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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
