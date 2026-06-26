import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { syncWalletsFromUsersTable } from "@/lib/sync-wallets";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/me";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      // Auto-import wallets from the users table for this email
      if (data.user.email) {
        await syncWalletsFromUsersTable(data.user.id, data.user.email);
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
