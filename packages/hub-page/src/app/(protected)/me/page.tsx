import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "./SignOutButton";
import { WalletPickerModal } from "./WalletPickerModal";
import { SecuritySettings } from "./SecuritySettings";
import { PassPreviewCard } from "./PassPreviewCard";
import { PhoneEditor } from "./PhoneEditor";
import { LocationEditor } from "./LocationEditor";
import { RecentActivitySection } from "./RecentActivitySection";
import { SavedMerchantsSection } from "./SavedMerchantsSection";
import { getRecentActivity } from "@/lib/akiba/activity";
import { listSavedMerchants } from "@/lib/merchants/savedMerchants";
import { getUserBalance } from "@/lib/akiba/balance";
import { resolveHubProfile } from "@/lib/akiba/hubProfile";
import { getOrCreatePass } from "@/lib/akiba/pass";
import { ChevronRight, Gift, Bell } from "lucide-react";
import { MilesIcon } from "@/components/MilesIcon";
import { SettingsRow } from "@/components/akiba/SettingsRow";
import { createAdminClient } from "@/lib/supabase/admin";
import { UsernameEditor } from "./UsernameEditor";
import { resolveHubQuestCanonical } from "@/lib/akiba/canonicalPartnerQuests";
import { getNextRewardSummary, getNextRewardWays } from "@/lib/akiba/nextReward";
import { NextRewardPanel } from "@/components/akiba/NextRewardPanel";
import { PRIVACY_POLICY_URL, TERMS_URL, AKIBA_EMAIL } from "@/constants/links";

export const metadata = { title: "My Profile — Akiba Pass" };

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

  // Saved merchants (discovery-blueprint.md §6/§8) — read-only here;
  // unsaving happens from the merchant's own SaveMerchantButton.
  const savedMerchants = await listSavedMerchants(user.id);

  // Hub-native identity fields (merchant-shopping-quests-spec.md §5
  // "Country", extended for the "My Akiba" profile redesign with phone and
  // city). Legacy wallet-row country may prefill when unset, but this table
  // is the source of truth going forward.
  const { data: hubProfile } = await createAdminClient()
    .from("hub_user_profiles")
    .select("country, city, phone, phone_verified")
    .eq("user_id", user.id)
    .maybeSingle();
  const hubCountry = hubProfile?.country ?? activeRow?.country ?? null;

  // Next Reward Progress V1 (next-reward-progress-v1-spec.md) — /me loads
  // both the summary and the fuller "ways to get closer" list (quests +
  // games), unlike home which only loads the summary.
  let nextRewardSummary: Awaited<ReturnType<typeof getNextRewardSummary>> | null = null;
  let nextRewardWays: Awaited<ReturnType<typeof getNextRewardWays>> = [];
  try {
    [nextRewardSummary, nextRewardWays] = await Promise.all([
      getNextRewardSummary({
        hubUserId: user.id,
        email: user.email ?? null,
        legacyCountry: activeRow?.country ?? null,
      }),
      getNextRewardWays({ hubUserId: user.id, email: user.email ?? null }),
    ]);
  } catch (err) {
    console.error("[me] next reward lookup failed:", err);
  }

  // Leaderboard username (skill-games-leaderboards-spec.md §5.3) — same
  // canonical resolution the games surfaces use, so the claimed name is the
  // exact one that appears on the leaderboard. Now also the user's
  // permanent Akiba identity, shown in the header.
  const leaderboardCanonicalId = await resolveHubQuestCanonical({ hubUserId: user.id, email: user.email ?? null });
  const { data: leaderboardProfile } = await createAdminClient()
    .from("leaderboard_profiles")
    .select("username")
    .eq("canonical_id", leaderboardCanonicalId)
    .maybeSingle();

  // Profile completeness — one gentle, contextual nudge rather than a
  // checklist. Priority order reflects future product value: phone (auto
  // reward claims, M-Pesa/POS matching) > username (identity) > location
  // (nearby merchants). Nothing renders once every field is filled.
  const nudge = !hubProfile?.phone
    ? "Add your phone number to speed up future rewards"
    : !leaderboardProfile?.username
      ? "Choose your Akiba username"
      : !hubCountry
        ? "Tell us where you shop"
        : null;

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
        {/* Identity header — who am I */}
        <div className="mb-4 flex items-center gap-3 sm:mb-6 sm:gap-4">
          {activeRow?.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={activeRow.avatar_url} alt={displayName} className="h-12 w-12 shrink-0 rounded-full object-cover sm:h-14 sm:w-14" />
          ) : (
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-akiba-teal text-base font-semibold text-white sm:h-14 sm:w-14">
              {initials}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-sterling text-lg font-semibold text-akiba-ink sm:text-xl">{displayName}</h1>
            {leaderboardProfile?.username && (
              <p className="truncate text-sm font-medium text-akiba-teal">@{leaderboardProfile.username}</p>
            )}
            <p className="truncate text-xs text-akiba-muted">{user.email}</p>
          </div>
        </div>

        {/* Is my account complete — single contextual nudge, not a checklist */}
        {nudge && (
          <a
            href="#my-akiba-id"
            className="mb-4 flex items-center justify-between gap-2 rounded-xl bg-akiba-tint px-4 py-2.5 text-sm font-medium text-akiba-teal transition hover:bg-akiba-teal/10 sm:mb-6"
          >
            {nudge}
            <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
          </a>
        )}

        {/* Balance card — how many Miles do I have */}
        <div className="mb-4 overflow-hidden rounded-3xl bg-akiba-ink text-white sm:mb-6">
          <div className="px-5 py-5 sm:px-6 sm:py-8">
            <p className="flex items-center gap-1.5 text-sm font-medium text-white/60">
              <MilesIcon className="h-4 w-4 opacity-60" /> Balance
            </p>
            {hasBalance ? (
              <div>
                <p className="mt-1.5 font-sterling text-4xl font-semibold tabular-nums tracking-tight sm:mt-2 sm:text-5xl">
                  {balance.toLocaleString("en-KE")}
                </p>
                {/* Unconditional on ledgerBalance > 0 — a member with only
                    in-store ledger Miles (balance === ledgerBalance) still
                    gets a settlement-status indication on the app's single
                    most trust-critical figure. */}
                {ledgerBalance > 0 && (
                  <p className="mt-1 text-xs tabular-nums text-white/40">
                    {walletAddress
                      ? `includes ${ledgerBalance.toLocaleString("en-KE")} earned in-store, not yet on-chain`
                      : "Earned in-store, not yet on-chain"}
                  </p>
                )}
              </div>
            ) : needsPicker ? (
              <p className="mt-2 text-lg font-medium text-white/40">
                Choose an account above to see your balance
              </p>
            ) : (
              <p className="mt-2 text-lg font-medium text-white/30">
                We couldn&apos;t find a balance for this email yet
              </p>
            )}
          </div>
        </div>

        {/* Next reward progress (next-reward-progress-v1-spec.md §5.2) —
            NextRewardPanel itself renders null for inventory_unavailable
            (§9.5), so the wrapping margin is skipped for that state too. */}
        {nextRewardSummary && nextRewardSummary.state !== "inventory_unavailable" && (
          <div className="mb-4 sm:mb-6">
            <NextRewardPanel summary={nextRewardSummary} ways={nextRewardWays} />
          </div>
        )}

        {/* Primary actions — Pass is the prominent one; Invite is a slim earn nudge */}
        <div className="mb-4 space-y-2.5 sm:mb-6">
          {publicPassId && <PassPreviewCard publicPassId={publicPassId} />}
          <div className="overflow-hidden rounded-2xl border border-akiba-line bg-white">
            <SettingsRow
              icon={<Gift className="h-4 w-4 text-akiba-teal" aria-hidden="true" />}
              label="Invite friends, earn Miles"
              href="/referrals"
            />
          </div>
        </div>

        {/* Activity — what have I been doing */}
        <RecentActivitySection items={activity} />

        {/* Saved merchants — what do I care about */}
        <SavedMerchantsSection merchants={savedMerchants} />

        {/* My Akiba ID — identity completion */}
        <section id="my-akiba-id" className="mb-4 scroll-mt-6 sm:mb-6">
          <h2 className="mb-2.5 text-sm font-semibold uppercase tracking-wide text-akiba-muted sm:mb-3">
            My Akiba ID
          </h2>
          <div className="divide-y divide-akiba-line overflow-hidden rounded-2xl border border-akiba-line bg-white">
            <UsernameEditor initialUsername={leaderboardProfile?.username ?? null} />
            <PhoneEditor initialPhone={hubProfile?.phone ?? null} />
            <LocationEditor initialCountry={hubCountry} initialCity={hubProfile?.city ?? null} />
          </div>
        </section>

        {/* Account — how do I manage my account */}
        <section className="mb-4 sm:mb-6">
          <h2 className="mb-2.5 text-sm font-semibold uppercase tracking-wide text-akiba-muted sm:mb-3">
            Account
          </h2>
          <div className="divide-y divide-akiba-line overflow-hidden rounded-2xl border border-akiba-line bg-white">
            <SettingsRow
              icon={<Bell className="h-4 w-4 text-akiba-teal" aria-hidden="true" />}
              label="Notifications"
              href="/me/notifications"
            />
            <SecuritySettings />
          </div>
        </section>

        <div className="overflow-hidden rounded-2xl border border-akiba-line bg-white">
          <SignOutButton />
        </div>

        {/* Legal/support — quiet, small; reuses SiteFooter's links since
            the protected layout doesn't mount SiteFooter. */}
        <p className="mt-6 text-center text-xs text-akiba-muted/70">
          <a href={PRIVACY_POLICY_URL} className="hover:text-akiba-muted">Privacy Policy</a>
          {" · "}
          <a href={TERMS_URL} className="hover:text-akiba-muted">Terms</a>
          {" · "}
          <a href={`mailto:${AKIBA_EMAIL}`} className="hover:text-akiba-muted">Contact support</a>
        </p>
      </main>
    </>
  );
}
