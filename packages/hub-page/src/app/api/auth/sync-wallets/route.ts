import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { syncWalletsFromUsersTable } from "@/lib/sync-wallets";

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await syncWalletsFromUsersTable(user.id, user.email);
  return NextResponse.json(result);
}
