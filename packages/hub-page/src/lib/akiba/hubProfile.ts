// Shared "which wallet/name represents this Hub user" resolution — extracted
// from app/(protected)/me/page.tsx so /pass, /welcome and the home surfaces
// all resolve the same wallet/displayName a user sees on /me.
import { createAdminClient } from "@/lib/supabase/admin";

export type HubUserRow = {
  user_address: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  country: string | null;
  interests: string[] | null;
  is_member: boolean | null;
  phone: string | null;
  created_at: string;
};

export type HubProfile = {
  rows: HubUserRow[];
  activeRow: HubUserRow | null;
  walletAddress: string | null;
  displayName: string;
  needsPicker: boolean;
};

export async function resolveHubProfile(opts: {
  userId: string;
  email: string | null;
}): Promise<HubProfile> {
  const { userId, email } = opts;
  const admin = createAdminClient();

  const { data: savedWallet } = await admin
    .from("hub_user_wallets")
    .select("address")
    .eq("user_id", userId)
    .eq("ecosystem", "minipay")
    .maybeSingle();

  const { data: userRows, error: dbError } = await admin
    .from("users")
    .select("user_address, username, full_name, avatar_url, country, interests, is_member, phone, created_at")
    .eq("email", email ?? "")
    .order("created_at", { ascending: false });

  if (dbError) {
    console.error("[hubProfile] users query error →", dbError.message);
  }

  const rows = (userRows ?? []) as HubUserRow[];

  let activeRow = rows.find((r) => r.user_address === savedWallet?.address) ?? null;

  if (!activeRow && rows.length === 1) {
    activeRow = rows[0];
    await admin.from("hub_user_wallets").upsert(
      { user_id: userId, ecosystem: "minipay", address: activeRow.user_address.toLowerCase() },
      { onConflict: "user_id,ecosystem", ignoreDuplicates: true },
    );
  }

  const needsPicker = rows.length > 1 && !activeRow;
  const walletAddress = activeRow?.user_address ?? null;
  const displayName = activeRow?.full_name ?? activeRow?.username ?? email ?? "You";

  return { rows, activeRow, walletAddress, displayName, needsPicker };
}
