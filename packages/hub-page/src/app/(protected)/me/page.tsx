import Link from "next/link";
import { redirect } from "next/navigation";
import { MapPin, Settings } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveHubProfile } from "@/lib/akiba/hubProfile";
import { getUserBalance } from "@/lib/akiba/balance";
import { getRecentActivity } from "@/lib/akiba/activity";
import { getLinkedWalletAddresses, getOwnedVoucherPreviews } from "@/lib/akiba/myVouchers";
import { getProfileStats } from "@/lib/akiba/profileStats";
import { resolveHubQuestCanonical } from "@/lib/akiba/canonicalPartnerQuests";
import { listSavedMerchants } from "@/lib/merchants/savedMerchants";
import { getVerifiedDiscoveryHighlights } from "@/lib/home/verifiedDiscovery";
import { WalletPickerModal } from "./WalletPickerModal";
import { RecentActivitySection } from "./RecentActivitySection";
import { SavedMerchantsSection } from "./SavedMerchantsSection";
import { VerifiedPlacesSection } from "./VerifiedPlacesSection";
import { MyVouchersSection } from "./MyVouchersSection";

export const metadata = { title: "My Profile — Akiba Pass" };

export default async function MePage() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/login?next=/me");

  const email = user.email ?? null;
  const admin = createAdminClient();

  // Start independent identity reads together. Everything below depends on
  // one of these small results, so this keeps the server render from turning
  // into a long chain of sequential database calls.
  const [resolvedProfile, hubProfileResult, leaderboardCanonicalId, walletAddresses] = await Promise.all([
    resolveHubProfile({ userId: user.id, email }),
    admin
      .from("hub_user_profiles")
      .select("country, city")
      .eq("user_id", user.id)
      .maybeSingle(),
    resolveHubQuestCanonical({ hubUserId: user.id, email }),
    getLinkedWalletAddresses(user.id).catch(() => [] as string[]),
  ]);

  const { rows, activeRow, walletAddress, displayName, needsPicker } = resolvedProfile;
  const hubProfile = hubProfileResult.data;

  const [balanceResult, activity, savedMerchants, stats, leaderboardResult, verifiedPlaces, voucherPreview] = await Promise.all([
    getUserBalance({ walletAddress, email }),
    getRecentActivity({ userId: user.id, walletAddress, email, limit: 3 }),
    listSavedMerchants(user.id),
    getProfileStats({ userId: user.id, walletAddresses }),
    admin
      .from("leaderboard_profiles")
      .select("username")
      .eq("canonical_id", leaderboardCanonicalId)
      .maybeSingle(),
    getVerifiedDiscoveryHighlights(),
    getOwnedVoucherPreviews({ userId: user.id, walletAddresses, limit: 2 }),
  ]);

  const username = leaderboardResult.data?.username ?? activeRow?.username ?? null;
  const identityLabel = username ? `@${username}` : displayName;
  const location = [hubProfile?.city, hubProfile?.country ?? activeRow?.country]
    .filter(Boolean)
    .join(", ");
  const initialsSource = username ?? displayName ?? email ?? "AK";
  const initials = initialsSource
    .replace(/^@/, "")
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((part: string) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || "AK";

  return (
    <>
      {needsPicker && (
        <WalletPickerModal
          options={rows.map((row) => ({
            user_address: row.user_address,
            username: row.username,
            full_name: row.full_name,
            phone: row.phone,
            created_at: row.created_at,
          }))}
        />
      )}

      <main className="mx-auto max-w-3xl px-4 pb-6 pt-4 sm:px-6 sm:pb-10 sm:pt-8">
        <header className="relative overflow-hidden rounded-[2rem] border border-akiba-line bg-white px-5 pb-7 pt-5 text-center sm:px-8 sm:pb-9 sm:pt-7">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-akiba-muted">My Akiba</p>
            <Link
              href="/me/settings"
              aria-label="Open profile settings"
              className="flex h-11 w-11 items-center justify-center rounded-full border border-akiba-line bg-akiba-card text-akiba-ink transition hover:border-akiba-teal/30 hover:bg-akiba-tint hover:text-akiba-teal active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
            >
              <Settings className="h-5 w-5" aria-hidden="true" />
            </Link>
          </div>

          <div className="mx-auto flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-4 border-akiba-tint bg-akiba-teal text-2xl font-semibold text-white shadow-chip sm:h-28 sm:w-28 sm:text-3xl">
            {activeRow?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={activeRow.avatar_url} alt={`${identityLabel} profile`} className="h-full w-full object-cover" />
            ) : (
              <span aria-label={`${identityLabel} initials`}>{initials}</span>
            )}
          </div>

          <h1 className="mt-4 break-words font-sterling text-2xl font-semibold tracking-tight text-akiba-ink sm:text-3xl">
            {identityLabel}
          </h1>
          {email && <p className="mt-1 break-all text-sm text-akiba-muted">{email}</p>}
          <p className="mt-2 flex min-h-5 items-center justify-center gap-1.5 text-xs font-medium text-akiba-muted">
            <MapPin className="h-3.5 w-3.5 text-akiba-teal" aria-hidden="true" />
            {location || "Location not set"}
          </p>
        </header>

        <section className="relative -mt-3 mb-8 px-2" aria-label="Your Akiba stats">
          <dl className="grid grid-cols-3 overflow-hidden rounded-2xl border border-akiba-line bg-white shadow-chip">
            <div className="min-w-0 px-2 py-4 text-center sm:px-4 sm:py-5">
              <dd className="font-sterling text-2xl font-semibold tabular-nums text-akiba-ink sm:text-3xl">
                {!needsPicker && balanceResult.hasBalance
                  ? balanceResult.balance.toLocaleString("en-KE")
                  : "—"}
              </dd>
              <dt className="mt-1 text-[11px] font-medium leading-tight text-akiba-muted sm:text-xs">Available Miles</dt>
            </div>
            <div className="min-w-0 border-x border-akiba-line px-2 py-4 text-center sm:px-4 sm:py-5">
              <dd className="font-sterling text-2xl font-semibold tabular-nums text-akiba-ink sm:text-3xl">
                {stats.placesVisited.toLocaleString("en-KE")}
              </dd>
              <dt className="mt-1 text-[11px] font-medium leading-tight text-akiba-muted sm:text-xs">Places visited</dt>
            </div>
            <div className="min-w-0 px-2 py-4 text-center sm:px-4 sm:py-5">
              <dd className="font-sterling text-2xl font-semibold tabular-nums text-akiba-ink sm:text-3xl">
                {stats.rewardsUsed.toLocaleString("en-KE")}
              </dd>
              <dt className="mt-1 text-[11px] font-medium leading-tight text-akiba-muted sm:text-xs">Rewards used</dt>
            </div>
          </dl>
        </section>

        <MyVouchersSection preview={voucherPreview} />
        <SavedMerchantsSection merchants={savedMerchants} showEmpty />
        <VerifiedPlacesSection highlights={verifiedPlaces} />
        <RecentActivitySection items={activity} />
      </main>
    </>
  );
}
