"use client";

import { useEffect, useState } from "react";
import { Copy, Share2, Check } from "lucide-react";
import { track } from "@/lib/analytics/track";
import { MilesAmount } from "@/components/MilesIcon";
import type { ReferralDashboard } from "@/lib/akiba/referralDashboard";

const SHARE_TEXT =
  "Join me on Akiba Pass to earn Miles when you shop and use rewards. Get your Pass here:";

type ShareChannel = "copy" | "native_share" | "whatsapp";

// referral-system-spec.md §9.2 required state copy table.
const STATE_COPY: Record<ReferralDashboard["referrals"][number]["state"], string> = {
  joined_pending: "Friend joined · Miles pending",
  joined: "Friend joined · Miles earned",
  activation_pending: "Friend became active · Miles pending",
  complete: "Referral complete · Miles earned",
  under_review: "Reward under review",
  expired: "Activation window ended · Miles earned",
  not_eligible: "This referral was not eligible",
};

function recordShareEvent(channel: ShareChannel) {
  track("referral_share_tap", { channel });
  if (channel === "copy") track("referral_link_copy");
  fetch("/api/referrals/share-event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel }),
  }).catch(() => {
    // Analytics-only — a failed request here must never surface to the member.
  });
}

export function ReferralsPageClient({ dashboard }: { dashboard: ReferralDashboard }) {
  const [copied, setCopied] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);

  useEffect(() => {
    track("referral_page_view");
    setCanNativeShare(typeof navigator !== "undefined" && "share" in navigator);
  }, []);

  const { program, invite, summary, referrals } = dashboard;
  const shareUrl = invite.url;
  const fullShareText = `${SHARE_TEXT} ${shareUrl}`;
  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(fullShareText)}`;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      recordShareEvent("copy");
      setTimeout(() => setCopied(false), 3000);
    } catch {
      // Clipboard access can be denied — the link is still visible/selectable on the page.
    }
  }

  async function handleNativeShare() {
    try {
      await navigator.share({ text: SHARE_TEXT, url: shareUrl });
      recordShareEvent("native_share");
    } catch {
      // User-cancelled share sheet — not an error.
    }
  }

  return (
    <div>
      {/* 1. Offer header */}
      <h1 className="font-sterling text-2xl font-semibold text-akiba-ink">Invite friends</h1>
      <div className="mt-3 flex gap-3">
        <div className="flex-1 rounded-2xl border border-akiba-line bg-white p-3.5">
          <MilesAmount amount={program.signupMiles} size="lg" />
          <p className="mt-1 text-sm text-akiba-muted">when a friend joins Akiba Pass</p>
        </div>
        <div className="flex-1 rounded-2xl border border-akiba-line bg-white p-3.5">
          <MilesAmount amount={program.activationMiles} size="lg" />
          <p className="mt-1 text-sm text-akiba-muted">more after their first qualifying purchase or eligible voucher use</p>
        </div>
      </div>

      {program.status !== "active" && (
        <p role="status" className="mt-3 rounded-xl bg-akiba-tint px-3.5 py-2.5 text-sm text-akiba-ink">
          Referrals are temporarily paused. You can still share your link — new invites just won&apos;t earn Miles right now.
        </p>
      )}

      {/* 2. Share actions */}
      {shareUrl && (
        <section className="mt-5 rounded-2xl border border-akiba-line bg-white p-4">
          <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-akiba-muted">Share your link</p>

          <div className="flex flex-wrap gap-2">
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => recordShareEvent("whatsapp")}
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[#25D366] px-4 py-2.5 text-sm font-semibold text-white transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-ink"
              aria-label="Share your invite link on WhatsApp"
            >
              WhatsApp
            </a>

            {canNativeShare && (
              <button
                type="button"
                onClick={handleNativeShare}
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-akiba-line bg-white px-4 py-2.5 text-sm font-semibold text-akiba-ink transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
                aria-label="Share your invite link"
              >
                <Share2 className="h-4 w-4" aria-hidden="true" />
                Share
              </button>
            )}

            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-akiba-line bg-white px-4 py-2.5 text-sm font-semibold text-akiba-ink transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
              aria-label="Copy your invite link"
            >
              {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>

          {/* Live-region confirmation (§9.4) — announced without stealing focus. */}
          <p aria-live="polite" className="sr-only">
            {copied ? "Invite link copied to clipboard" : ""}
          </p>

          <p className="mt-3 truncate rounded-lg bg-akiba-card px-3 py-2 text-xs text-akiba-muted">{shareUrl}</p>
        </section>
      )}

      {/* 3. Eligibility/cap note */}
      {invite.canEarn ? (
        <p className="mt-3 text-sm text-akiba-muted">
          You can earn on {program.remainingRewardedReferrals} more referral
          {program.remainingRewardedReferrals === 1 ? "" : "s"} this period.
        </p>
      ) : invite.ineligibleReason === "limit_reached" ? (
        <p className="mt-3 text-sm text-akiba-muted">
          You&apos;ve reached this period&apos;s referral limit — your link still works, new invites just won&apos;t earn Miles until it resets.
        </p>
      ) : null}

      {/* 4. Progress summary */}
      <section className="mt-5 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl border border-akiba-line bg-white p-3">
          <p className="font-sterling text-xl font-semibold text-akiba-ink">{summary.friendsJoined}</p>
          <p className="text-xs text-akiba-muted">joined</p>
        </div>
        <div className="rounded-xl border border-akiba-line bg-white p-3">
          <p className="font-sterling text-xl font-semibold text-akiba-ink">{summary.friendsActivated}</p>
          <p className="text-xs text-akiba-muted">activated</p>
        </div>
        <div className="rounded-xl border border-akiba-line bg-white p-3">
          <MilesAmount amount={summary.milesEarned} size="md" className="justify-center" />
          <p className="text-xs text-akiba-muted">earned</p>
        </div>
      </section>

      {/* 5. Friend progress list */}
      {referrals.length > 0 && (
        <section className="mt-5">
          <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-akiba-muted">Your referrals</p>
          <ul className="divide-y divide-akiba-line rounded-2xl border border-akiba-line bg-white">
            {referrals.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-akiba-ink">{r.friendLabel}</p>
                  <p className="text-sm text-akiba-muted">{STATE_COPY[r.state]}</p>
                  {r.nextStep && <p className="mt-0.5 text-xs text-akiba-muted">{r.nextStep}</p>}
                </div>
                <div className="shrink-0 text-right">
                  {r.earnedMiles > 0 && <MilesAmount amount={r.earnedMiles} size="sm" />}
                  <p className="mt-0.5 text-xs text-akiba-muted">
                    {new Date(r.joinedAt).toLocaleDateString("en-KE", { month: "short", day: "numeric" })}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 6. How it works */}
      <section className="mt-5 rounded-2xl border border-akiba-line bg-white p-4">
        <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-akiba-muted">How it works</p>
        <ol className="space-y-3 text-sm text-akiba-ink">
          <li className="flex gap-3">
            <span className="font-sterling font-semibold text-akiba-teal">1</span>
            <span>Share your link with a friend who doesn&apos;t have Akiba Pass yet.</span>
          </li>
          <li className="flex gap-3">
            <span className="font-sterling font-semibold text-akiba-teal">2</span>
            <span>
              You earn <MilesAmount amount={program.signupMiles} size="sm" className="inline-flex" /> once they
              verify their email and create their Pass.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="font-sterling font-semibold text-akiba-teal">3</span>
            <span>
              You earn <MilesAmount amount={program.activationMiles} size="sm" className="inline-flex" /> more
              after their first qualifying purchase or eligible voucher use.
            </span>
          </li>
        </ol>
      </section>

      {/* 7. Terms */}
      <details
        className="mt-5 rounded-2xl border border-akiba-line bg-white p-4"
        onToggle={() => track("referral_terms_view")}
      >
        <summary className="cursor-pointer text-sm font-semibold text-akiba-ink">
          Referral terms
        </summary>
        <div className="mt-3 space-y-2 text-xs text-akiba-muted">
          <p>
            Both rewards require real activity: the second <MilesAmount amount={program.activationMiles} size="xs" className="inline-flex" /> needs
            a paid purchase or an eligible voucher redemption of at least the program&apos;s minimum spend — a Pass
            signup alone only ever earns the first reward.
          </p>
          <p>
            Rewards release after a short hold so we can check for abuse, and they expire from a referral if your
            friend doesn&apos;t become active within {program.activationWindowDays} days of creating their Pass —
            the first reward stays yours either way.
          </p>
          <p>
            Self-referrals, shared accounts, and disposable-account patterns are not eligible. Referral rewards are
            capped per period; your remaining capacity is shown above. We don&apos;t share your friend&apos;s
            purchase, voucher, or contact details with you.
          </p>
        </div>
      </details>
    </div>
  );
}
