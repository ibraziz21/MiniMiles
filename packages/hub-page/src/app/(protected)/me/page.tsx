import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { LinkedWallets } from "./LinkedWallets";
import { SignOutButton } from "./SignOutButton";
import { WalletPickerModal } from "./WalletPickerModal";
import { AkibaPassCard } from "./AkibaPassCard";
import { ShoppingBag, Ticket, ArrowUpRight, MapPin, Tag, Sparkles } from "lucide-react";
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

      <main className="mx-auto max-w-2xl px-4 py-10">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {activeRow?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={activeRow.avatar_url} alt={displayName} className="h-12 w-12 rounded-full object-cover" />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-akiba-teal text-base font-semibold text-white">
                {initials}
              </div>
            )}
            <div>
              <p className="font-semibold text-akiba-ink">{displayName}</p>
              <p className="text-sm text-akiba-muted">{user.email}</p>
            </div>
          </div>
          <SignOutButton />
        </div>

        {/* Balance card */}
        <div className="mb-6 overflow-hidden rounded-2xl bg-akiba-ink text-white">
          <div className="px-6 py-8">
            <p className="flex items-center gap-1.5 text-sm font-medium text-white/60">
              <MilesIcon className="h-4 w-4 opacity-60" /> Balance
            </p>
            {walletAddress ? (
              <>
                <p className="mt-2 font-sterling text-5xl font-semibold tracking-tight">
                  {balance?.toLocaleString("en-KE") ?? "—"}
                </p>
                <p className="mt-3 font-mono text-xs text-white/30">
                  {walletAddress.slice(0, 10)}…{walletAddress.slice(-6)}
                </p>
              </>
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

        {/* Akiba Pass — in-store QR card */}
        {publicPassId && (
          <div className="mb-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-akiba-muted">
              Your pass
            </h2>
            <AkibaPassCard
              initialPassId={publicPassId}
              email={user.email!}
              displayLabel={displayName}
            />
          </div>
        )}

        {/* Profile chips */}
        {activeRow && (activeRow.country || (activeRow.interests ?? []).length > 0) && (
          <div className="mb-6 flex flex-wrap gap-2">
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

        {/* Quick actions */}
        <div className="mb-6 grid grid-cols-3 gap-3">
          {[
            { href: "/shop", icon: <ShoppingBag className="h-5 w-5 text-akiba-teal" />, label: "Shop & earn" },
            { href: "/me/orders", icon: <Ticket className="h-5 w-5 text-akiba-teal" />, label: "My orders" },
            { href: "/rewards", icon: <Sparkles className="h-5 w-5 text-akiba-teal" />, label: "Rewards" },
          ].map(({ href, icon, label }) => (
            <a
              key={href}
              href={href}
              className="flex flex-col items-center gap-2 rounded-2xl border border-akiba-line bg-white p-4 text-center transition hover:border-akiba-teal/40 hover:shadow-chip"
            >
              {icon}
              <span className="text-xs font-medium text-akiba-ink">{label}</span>
            </a>
          ))}
        </div>

        {/* No wallet found */}
        {!walletAddress && !needsPicker && (
          <div className="mb-6 rounded-2xl border border-dashed border-akiba-teal/30 bg-akiba-tint px-6 py-6 text-center">
            <p className="text-sm font-medium text-akiba-ink">No MiniPay wallet found</p>
            <p className="mt-1 text-xs text-akiba-muted">
              Make sure you sign in with the same email you used in MiniPay.
            </p>
          </div>
        )}

        <LinkedWallets
          minipayAddress={walletAddress}
          hasMultiple={rows.length > 1}
          userId={user.id}
        />

        {/* Activity */}
        {walletAddress && (
          <div className="mt-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-akiba-muted">
              Recent activity
            </h2>
            <div className="rounded-2xl border border-akiba-line bg-akiba-card px-6 py-10 text-center">
              <MilesIcon className="mx-auto mb-3 h-8 w-8 opacity-20" />
              <p className="text-sm font-medium text-akiba-ink">No activity yet</p>
              <p className="mt-1 text-xs text-akiba-muted">
                Complete quests or shop at a merchant to start earning.
              </p>
              <a href="/" className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-akiba-teal">
                Explore opportunities <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
