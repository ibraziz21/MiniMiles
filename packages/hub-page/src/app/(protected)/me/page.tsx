import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { LinkedWallets } from "./LinkedWallets";
import { SignOutButton } from "./SignOutButton";
import { WalletPickerModal } from "./WalletPickerModal";
import { AkibaPassCard } from "./AkibaPassCard";
import { ProfileQuickActions } from "./ProfileQuickActions";
import { ActivityFeed } from "./ActivityFeed";
import { getRecentActivity } from "@/lib/akiba/activity";
import { ArrowUpRight, MapPin, Tag } from "lucide-react";
import { MilesIcon } from "@/components/MilesIcon";

export const metadata = { title: "My Profile — Akiba Hub" };

const MINIPOINTS = process.env.MINIPOINTS_ADDRESS;
const CELO_RPC = process.env.CELO_RPC_URL ?? "https://forno.celo.org";

async function readBalance(address: string): Promise<number> {
  if (!MINIPOINTS) {
    console.log("[me] readBalance: MINIPOINTS_ADDRESS not set, returning 0");
    return 0;
  }
  console.log(`[me] readBalance: calling balanceOf(${address}) on ${MINIPOINTS} via ${CELO_RPC}`);
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
      cache: "no-store",
    });
    const json = await res.json();
    console.log("[me] readBalance: raw RPC result →", json.result);
    if (!json.result || json.result === "0x") {
      console.log("[me] readBalance: empty result, balance = 0");
      return 0;
    }
    const balance = Number(BigInt(json.result) / BigInt(1e18));
    console.log(`[me] readBalance: parsed balance = ${balance} miles`);
    return balance;
  } catch (err) {
    console.error("[me] readBalance: RPC call failed →", err);
    return 0;
  }
}

const INTEREST_LABELS: Record<string, string> = {
  games: "Games", vouchers: "Vouchers", raffles: "Raffles",
  defi: "DeFi", quests: "Quests", leaderboards: "Leaderboards",
};

export default async function MePage() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/login?next=/me");

  console.log(`[me] session user: id=${user.id} email=${user.email}`);

  const admin = createAdminClient();

  // 1. Check if user has already made a wallet choice (saved in hub_user_wallets)
  console.log(`[me] checking hub_user_wallets for saved choice (user_id=${user.id})`);
  const { data: savedWallet } = await admin
    .from("hub_user_wallets")
    .select("address")
    .eq("user_id", user.id)
    .eq("ecosystem", "minipay")
    .maybeSingle();

  console.log(`[me] saved wallet choice: ${savedWallet?.address ?? "none"}`);

  // 2. Query users table by email — fetch all rows (email is not unique)
  console.log(`[me] querying users WHERE email = '${user.email}'`);
  const { data: userRows, error: dbError } = await admin
    .from("users")
    .select("user_address, username, full_name, avatar_url, country, interests, is_member, phone, created_at")
    .eq("email", user.email!)
    .order("created_at", { ascending: false });

  if (dbError) {
    console.error("[me] users query error →", dbError.message);
  } else {
    console.log(`[me] found ${userRows?.length ?? 0} row(s) in users for this email`);
    userRows?.forEach((r, i) =>
      console.log(`[me]   [${i}] user_address=${r.user_address} username=${r.username} created_at=${r.created_at}`)
    );
  }

  const rows = userRows ?? [];

  // 3. Resolve which address to use
  let activeRow = rows.find((r) => r.user_address === savedWallet?.address) ?? null;

  if (!activeRow && rows.length === 1) {
    // Single wallet — use it automatically and save the preference
    activeRow = rows[0];
    console.log(`[me] single wallet found, auto-saving: ${activeRow.user_address}`);
    await admin.from("hub_user_wallets").upsert(
      { user_id: user.id, ecosystem: "minipay", address: activeRow.user_address.toLowerCase() },
      { onConflict: "user_id,ecosystem", ignoreDuplicates: true }
    );
  }

  const needsPicker = rows.length > 1 && !activeRow;
  console.log(`[me] needsPicker=${needsPicker} activeRow=${activeRow?.user_address ?? "none"}`);

  const walletAddress = activeRow?.user_address ?? null;
  console.log(`[me] wallet address to use: ${walletAddress ?? "none"}`);

  const balance = walletAddress ? await readBalance(walletAddress) : null;
  console.log(`[me] final balance: ${balance ?? "n/a"} miles`);

  const displayName = activeRow?.full_name ?? activeRow?.username ?? user.email ?? "You";
  const initials = displayName.slice(0, 2).toUpperCase();

  // Fetch or create the stable Akiba Pass ID for this user
  let publicPassId: string | null = null;
  if (user.email) {
    let { data: passRow } = await admin
      .from("hub_user_passes")
      .select("public_pass_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!passRow) {
      const { data: inserted } = await admin
        .from("hub_user_passes")
        .insert({ user_id: user.id, email: user.email })
        .select("public_pass_id")
        .single();
      passRow = inserted;
    }

    publicPassId = passRow?.public_pass_id ?? null;
  }

  // Recent activity — merchant scan awards + engagement-layer earnings
  const activity = await getRecentActivity({
    userId: user.id,
    walletAddress,
    limit: 6,
  });

  return (
    <>
      {/* Wallet picker modal — shown only when multiple wallets and no choice saved */}
      {needsPicker && (
        <WalletPickerModal
          options={rows.map((r) => ({
            user_address: r.user_address,
            username: r.username,
            full_name: r.full_name,
            phone: r.phone,
            created_at: r.created_at,
          }))}
        />
      )}

      <main className="mx-auto max-w-2xl px-4 py-5 sm:py-10">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between sm:mb-8">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            {activeRow?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={activeRow.avatar_url} alt={displayName} className="h-11 w-11 rounded-full object-cover sm:h-12 sm:w-12" />
            ) : (
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-akiba-teal text-base font-semibold text-white sm:h-12 sm:w-12">
                {initials}
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate font-semibold text-akiba-ink">{displayName}</p>
              <p className="truncate text-sm text-akiba-muted">{user.email}</p>
            </div>
          </div>
          <SignOutButton />
        </div>

        {/* Balance card */}
        <div className="mb-4 overflow-hidden rounded-2xl bg-akiba-ink text-white sm:mb-6">
          <div className="px-5 py-5 sm:px-6 sm:py-8">
            <p className="flex items-center gap-1.5 text-sm font-medium text-white/60">
              <MilesIcon className="h-4 w-4 opacity-60" /> Balance
            </p>
            {walletAddress ? (
              <div className="flex items-end justify-between gap-3">
                <p className="mt-1.5 font-sterling text-4xl font-semibold tracking-tight sm:mt-2 sm:text-5xl">
                  {balance?.toLocaleString("en-KE") ?? "—"}
                </p>
                <p className="mb-1 font-mono text-[10px] text-white/30 sm:text-xs">
                  {walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}
                </p>
              </div>
            ) : needsPicker ? (
              <p className="mt-2 text-lg font-medium text-white/40">
                Choose a wallet above to see your balance
              </p>
            ) : (
              <p className="mt-2 text-lg font-medium text-white/30">
                No wallet found for this email
              </p>
            )}
          </div>
        </div>

        {/* Quick actions — Pass & Wallets open sheets; rest are links */}
        <div className="mb-4 sm:mb-6">
          <ProfileQuickActions
            passSlot={
              publicPassId ? (
                <AkibaPassCard
                  initialPassId={publicPassId}
                  email={user.email!}
                  displayLabel={displayName}
                />
              ) : undefined
            }
            walletsSlot={
              <LinkedWallets
                minipayAddress={walletAddress}
                hasMultiple={rows.length > 1}
                userId={user.id}
                variant="sheet"
              />
            }
          />
        </div>

        {/* Profile chips — secondary info, desktop only */}
        {activeRow && (activeRow.country || (activeRow.interests ?? []).length > 0) && (
          <div className="mb-6 hidden flex-wrap gap-2 sm:flex">
            {activeRow.country && (
              <span className="flex items-center gap-1.5 rounded-full border border-akiba-line bg-akiba-card px-3 py-1 text-xs font-medium text-akiba-muted">
                <MapPin className="h-3 w-3" /> {activeRow.country}
              </span>
            )}
            {(activeRow.interests ?? []).map((interest: string) => (
              <span
                key={interest}
                className="flex items-center gap-1.5 rounded-full border border-akiba-teal/20 bg-akiba-tint px-3 py-1 text-xs font-medium text-akiba-teal"
              >
                <Tag className="h-3 w-3" /> {INTEREST_LABELS[interest] ?? interest}
              </span>
            ))}
          </div>
        )}

        {/* No wallet found */}
        {!walletAddress && !needsPicker && (
          <div className="mb-4 rounded-2xl border border-dashed border-akiba-teal/30 bg-akiba-tint px-6 py-5 text-center sm:mb-6">
            <p className="text-sm font-medium text-akiba-ink">No MiniPay wallet found</p>
            <p className="mt-1 text-xs text-akiba-muted">
              Make sure you sign in with the same email you used in MiniPay.
            </p>
          </div>
        )}

        {/* Activity — merchant awards + engagement earnings */}
        <div>
          <div className="mb-2.5 flex items-center justify-between sm:mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-akiba-muted">
              Recent activity
            </h2>
            {activity.length >= 6 && (
              <a
                href="/me/activity"
                className="flex items-center gap-1 text-xs font-semibold text-akiba-teal"
              >
                View all <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
          <ActivityFeed items={activity.slice(0, 5)} />
        </div>
      </main>
    </>
  );
}
