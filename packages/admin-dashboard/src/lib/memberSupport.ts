import "server-only";
import { supabase } from "./supabase";
import { voucherReadAll } from "./voucherCatalogue";
export async function memberDirectory(q: string, page: number) {
  const [profiles, links] = await Promise.all([
    voucherReadAll((from, to) =>
      supabase
        .from("leaderboard_profiles")
        .select("canonical_id,username")
        .not("canonical_id", "is", null)
        .not("username", "is", null)
        .order("canonical_id")
        .range(from, to)
    ),
    voucherReadAll((from, to) =>
      supabase
        .from("hub_user_canonicals")
        .select("canonical_id,hub_user_id")
        .order("canonical_id")
        .order("hub_user_id")
        .range(from, to)
    ),
  ]).catch(() => [null, null]);
  if (!profiles || !links) return { data: [], count: 0, error: true };
  const ids = new Set(links.map((l) => l.canonical_id));
  const clean = q.replace(/^@/, "").trim().toLowerCase();
  const rows = profiles
    .filter(
      (p) =>
        ids.has(p.canonical_id) &&
        `${p.username} ${p.canonical_id}`.toLowerCase().includes(clean)
    )
    .sort(
      (a, b) =>
        String(a.username).localeCompare(String(b.username)) ||
        a.canonical_id.localeCompare(b.canonical_id)
    );
  return {
    data: rows.slice((page - 1) * 50, page * 50),
    count: rows.length,
    error: null,
  };
}
export async function memberSupport(id: string) {
  const profile = await supabase
    .from("leaderboard_profiles")
    .select("canonical_id,username")
    .eq("canonical_id", id)
    .maybeSingle();
  if (profile.error) throw new Error("Member identity unavailable");
  if (!profile.data) return null;
  const links = await supabase
    .from("hub_user_canonicals")
    .select("hub_user_id")
    .eq("canonical_id", id);
  if (links.error || links.data?.length !== 1)
    throw new Error("Member identity is incomplete or ambiguous");
  const userId = links.data[0].hub_user_id;
  const [auth, ledger, vouchers, deletions] = await Promise.all([
    supabase.auth.admin.getUserById(userId),
    voucherReadAll((from, to) =>
      supabase
        .from("miles_ledger")
        .select("id,amount,direction,source_type,created_at,partner_id")
        .eq("canonical_id", id)
        .eq("on_chain", false)
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to)
    ),
    voucherReadAll((from, to) =>
      supabase
        .from("issued_vouchers")
        .select("id,code,status,created_at,expires_at,redeemed_at")
        .eq("hub_user_id", userId)
        .in("status", ["issued", "redeemed", "revoked", "expired"])
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to)
    ),
    supabase
      .from("account_deletion_requests")
      .select("id,status,requested_at")
      .eq("hub_user_id", userId)
      .order("requested_at", { ascending: false }),
  ]);
  if (auth.error || deletions.error)
    throw new Error("Member support data unavailable");
  return {
    profile: profile.data,
    user: auth.data.user,
    ledger,
    vouchers,
    deletions: deletions.data ?? [],
    balance: ledger.reduce(
      (n, r) => n + (r.direction === "credit" ? 1 : -1) * Number(r.amount),
      0
    ),
  };
}
