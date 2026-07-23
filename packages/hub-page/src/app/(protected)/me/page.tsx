import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LinkedWallets } from "./LinkedWallets";
import { SignOutButton } from "./SignOutButton";
import { WalletPickerModal } from "./WalletPickerModal";
import { AkibaPassCard } from "./AkibaPassCard";
import { SetPasswordForm } from "./SetPasswordForm";
import { ProfileQuickActions } from "./ProfileQuickActions";
import { ActivityFeed } from "./ActivityFeed";
import { getRecentActivity } from "@/lib/akiba/activity";
import { getUserBalance } from "@/lib/akiba/balance";
import { resolveHubProfile } from "@/lib/akiba/hubProfile";
import { getOrCreatePass } from "@/lib/akiba/pass";
import { ArrowUpRight, MapPin, Tag } from "lucide-react";
import { MilesIcon } from "@/components/MilesIcon";

export const metadata = { title: "My Profile — Akiba Pass" };

const INTEREST_LABELS: Record<string, string> = {
  games: "Games", vouchers: "Vouchers", raffles: "Raffles",
  defi: "DeFi", quests: "Quests", leaderboards: "Leaderboards",
};

export default async function MePage() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/login?next=/me");

  const { rows, activeRow, walletAddress, displayName, needsPicker } =
    await resolveHubProfile({ userId: user.id, email: user.email ?? null });

  // One number: on-chain (claimed) + Platform ledger (unclaimed in-store Miles).
  // Email-only users have no wallet but can still hold ledger Miles from scans.
  const { ledgerBalance, balance, hasBalance } = await getUserBalance({
    walletAddress,
    email: user.email ?? null,
  });

  const initials = displayName.slice(0, 2).toUpperCase();

  // Fetch or create the stable Akiba Pass ID for this user
  const { publicPassId } = await getOrCreatePass({
    userId: user.id,
    email: user.email ?? null,
    walletAddress,
  });

  // Recent activity — merchant scan awards + engagement-layer earnings
  const activity = await getRecentActivity({
    userId: user.id,
    walletAddress,
    email: user.email ?? null,
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
            {hasBalance ? (
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="mt-1.5 font-sterling text-4xl font-semibold tracking-tight sm:mt-2 sm:text-5xl">
                    {balance.toLocaleString("en-KE")}
                  </p>
                  {ledgerBalance > 0 && walletAddress && (
                    <p className="mt-1 text-xs text-white/40">
                      includes {ledgerBalance.toLocaleString("en-KE")} earned in-store
                    </p>
                  )}
                </div>
                {walletAddress && (
                  <p className="mb-1 font-mono text-[10px] text-white/30 sm:text-xs">
                    {walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}
                  </p>
                )}
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
            securitySlot={<SetPasswordForm />}
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
