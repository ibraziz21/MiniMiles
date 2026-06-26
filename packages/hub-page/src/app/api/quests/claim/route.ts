import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const quest_id = body?.quest_id;
  if (typeof quest_id !== "string" || !quest_id) {
    return NextResponse.json({ error: "quest_id is required" }, { status: 400 });
  }

  // ── MiniPay wallet resolution ──────────────────────────────────────────────
  // Quests are claimed against a MiniPay wallet — the platform uses it to
  // verify on-chain eligibility and allocate miles to the correct address.
  const admin = createAdminClient();
  const { data: wallets } = await admin
    .from("hub_user_wallets")
    .select("address, ecosystem")
    .eq("user_id", user.id)
    .eq("ecosystem", "minipay")
    .order("linked_at", { ascending: false })
    .limit(1);

  if (!wallets || wallets.length === 0) {
    return NextResponse.json(
      { error: "Link a MiniPay wallet to claim quests." },
      { status: 400 }
    );
  }

  const address = (wallets[0] as { address: string }).address.toLowerCase();

  // ── Akiba Platform claim ──────────────────────────────────────────────────
  const api = process.env.AKIBA_API_URL;
  const key = process.env.AKIBA_API_KEY;

  if (!api || !key) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  let platformRes: Response;
  try {
    platformRes = await fetch(`${api}/api/v1/hub/quests/${quest_id}/claim`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify({
        address,
        ecosystem: "minipay",
        user_id: user.id,
      }),
    });
  } catch {
    return NextResponse.json({ error: "Could not reach Akiba Platform" }, { status: 503 });
  }

  const data = await platformRes.json().catch(() => ({})) as Record<string, unknown>;

  if (!platformRes.ok) {
    // 404 from Platform = claim endpoint not yet live for this quest.
    if (platformRes.status === 404) {
      return NextResponse.json(
        { error: "This quest cannot be claimed directly yet. Check back soon." },
        { status: 503 }
      );
    }
    const msg = (data.error ?? data.message ?? "Claim failed") as string;
    return NextResponse.json({ error: msg }, { status: platformRes.status });
  }

  return NextResponse.json(data, { status: 200 });
}
