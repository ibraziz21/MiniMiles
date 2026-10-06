import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowLeft,
  Bell,
  ExternalLink,
  Mail,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveHubProfile } from "@/lib/akiba/hubProfile";
import { resolveHubQuestCanonical } from "@/lib/akiba/canonicalPartnerQuests";
import { SettingsRow } from "@/components/akiba/SettingsRow";
import { UsernameEditor } from "../UsernameEditor";
import { PhoneEditor } from "../PhoneEditor";
import { LocationEditor } from "../LocationEditor";
import { SecuritySettings } from "../SecuritySettings";
import { LinkedWallets } from "../LinkedWallets";
import { SignOutButton } from "../SignOutButton";
import { WalletPickerModal } from "../WalletPickerModal";
import { AKIBA_EMAIL, PRIVACY_POLICY_URL, TERMS_URL } from "@/constants/links";

export const metadata = { title: "Settings — Akiba Pass" };

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/login?next=/me/settings");

  const email = user.email ?? null;
  const admin = createAdminClient();
  const [resolvedProfile, hubProfileResult, canonicalId] = await Promise.all([
    resolveHubProfile({ userId: user.id, email }),
    admin
      .from("hub_user_profiles")
      .select("country, city, phone")
      .eq("user_id", user.id)
      .maybeSingle(),
    resolveHubQuestCanonical({ hubUserId: user.id, email }),
  ]);

  const leaderboardResult = await admin
    .from("leaderboard_profiles")
    .select("username")
    .eq("canonical_id", canonicalId)
    .maybeSingle();

  const { rows, activeRow, walletAddress, displayName, needsPicker } = resolvedProfile;
  const hubProfile = hubProfileResult.data;
  const username = leaderboardResult.data?.username ?? activeRow?.username ?? null;
  const identityLabel = username ? `@${username}` : displayName;
  const initials = (username ?? displayName ?? email ?? "AK")
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

      <main className="mx-auto max-w-2xl px-4 pb-8 pt-4 sm:px-6 sm:pb-12 sm:pt-8">
        <Link
          href="/me"
          className="mb-5 inline-flex min-h-11 items-center gap-1.5 rounded-lg pr-3 text-sm font-medium text-akiba-muted transition hover:text-akiba-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to profile
        </Link>

        <div className="mb-6">
          <h1 className="font-sterling text-3xl font-semibold text-akiba-ink">Settings</h1>
          <p className="mt-1 text-sm text-akiba-muted">Manage your profile, sign-in and preferences.</p>
        </div>

        <div className="mb-7 flex items-center gap-4 rounded-2xl border border-akiba-line bg-white p-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-akiba-teal text-lg font-semibold text-white">
            {activeRow?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={activeRow.avatar_url} alt={`${identityLabel} profile`} className="h-full w-full object-cover" />
            ) : (
              initials
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate font-sterling text-lg font-semibold text-akiba-ink">{identityLabel}</p>
            {email && <p className="truncate text-sm text-akiba-muted">{email}</p>}
          </div>
        </div>

        <SettingsSection title="Profile details">
          <UsernameEditor initialUsername={username} />
          <PhoneEditor initialPhone={hubProfile?.phone ?? null} />
          <LocationEditor
            initialCountry={hubProfile?.country ?? activeRow?.country ?? null}
            initialCity={hubProfile?.city ?? null}
            savedToProfile={Boolean(hubProfile?.country)}
          />
        </SettingsSection>

        <SettingsSection title="Notifications">
          <SettingsRow
            icon={<Bell className="h-4 w-4 text-akiba-teal" aria-hidden="true" />}
            label="Notifications"
            description="Reward and account updates"
            href="/me/notifications"
          />
        </SettingsSection>

        <SettingsSection title="Account & security">
          <SettingsRow
            icon={<Mail className="h-4 w-4 text-akiba-teal" aria-hidden="true" />}
            label="Email"
            description={email ?? "No email on this account"}
            showChevron={false}
          />
          <SecuritySettings />
        </SettingsSection>

        <section className="mb-7">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-akiba-muted">Linked accounts</h2>
          <div className="mb-3 flex items-center gap-2 text-xs text-akiba-muted">
            <Wallet className="h-4 w-4" aria-hidden="true" /> Wallets used for Miles and rewards
          </div>
          <LinkedWallets
            minipayAddress={walletAddress}
            hasMultiple={rows.length > 1}
            userId={user.id}
            variant="sheet"
          />
        </section>

        <SettingsSection title="Help & legal">
          <SettingsRow
            icon={<ExternalLink className="h-4 w-4 text-akiba-teal" aria-hidden="true" />}
            label="Contact support"
            description={AKIBA_EMAIL}
            href={`mailto:${AKIBA_EMAIL}`}
          />
          <SettingsRow
            icon={<ShieldCheck className="h-4 w-4 text-akiba-teal" aria-hidden="true" />}
            label="Privacy policy"
            href={PRIVACY_POLICY_URL}
          />
          <SettingsRow
            icon={<ShieldCheck className="h-4 w-4 text-akiba-teal" aria-hidden="true" />}
            label="Terms of use"
            href={TERMS_URL}
          />
        </SettingsSection>

        <div className="overflow-hidden rounded-2xl border border-red-100 bg-white">
          <SignOutButton />
        </div>
      </main>
    </>
  );
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-7">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-akiba-muted">{title}</h2>
      <div className="divide-y divide-akiba-line overflow-hidden rounded-2xl border border-akiba-line bg-white">
        {children}
      </div>
    </section>
  );
}
