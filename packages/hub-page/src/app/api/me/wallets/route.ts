import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const VALID_ECOSYSTEMS = ["minipay", "base"] as const;
type Ecosystem = (typeof VALID_ECOSYSTEMS)[number];

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const { ecosystem, address } = body ?? {};

  if (!VALID_ECOSYSTEMS.includes(ecosystem as Ecosystem)) {
    return NextResponse.json({ error: "Invalid ecosystem" }, { status: 400 });
  }

  if (!address?.match(/^0x[0-9a-fA-F]{40}$/)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  const normalised = (address as string).toLowerCase();
  const admin = createAdminClient();

  // 1. Save to the hub bridge table
  const { error: bridgeError } = await admin
    .from("hub_user_wallets")
    .upsert(
      { user_id: user.id, ecosystem, address: normalised },
      { onConflict: "user_id,ecosystem" }
    );

  if (bridgeError) {
    if (bridgeError.code === "23505") {
      return NextResponse.json(
        { error: "This address is already linked to another account" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: bridgeError.message }, { status: 500 });
  }

  // 2. Ensure a record exists in the main `users` table for this wallet.
  //    We upsert so that existing mini-app users keep all their data intact;
  //    new users get a fresh record with their email back-filled.
  const { error: userError } = await admin
    .from("users")
    .upsert(
      {
        user_address: normalised,
        email: user.email ?? null,
        is_member: true,
      },
      {
        onConflict: "user_address",
        // Only set email if the row doesn't have one yet
        ignoreDuplicates: false,
      }
    );

  if (userError) {
    // Non-fatal — the bridge record was saved; log and continue
    console.error("[hub] users upsert failed:", userError.message);
  }

  return NextResponse.json({ ok: true });
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("hub_user_wallets")
    .select("ecosystem, address, is_primary, linked_at")
    .eq("user_id", user.id)
    .order("linked_at");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
