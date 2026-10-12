// GET /account-deletion — AKIBA-MOB-002 §6.
//
// Google Play requires a *working* public web resource for account deletion,
// not just a policy paragraph, and it has to name the app and developer as
// they appear in the listing. Apple can use the same URL as the optional
// User Privacy Choices link. So this page is public, indexable, renders
// without a session, and — unlike the maintenance-gated native surfaces —
// has nothing that can take it offline.
//
// It is not a second implementation of deletion: the client flow calls the
// same /api/v1/me/account-deletion* routes the app does, so the two paths
// cannot drift in what they verify or what they record.
import type { Metadata } from "next";

import { createClient } from "@/lib/supabase/server";
import { DELETION_POLICY_VERSION, PROCESSING_TARGET_DAYS } from "@/lib/akiba/accountDeletionPolicy";
import { maskEmail } from "@/lib/akiba/maskEmail";

import { AccountDeletionFlow } from "./AccountDeletionFlow";

export const metadata: Metadata = {
  title: "Delete your Akiba Pass account — Akiba",
  description:
    "Request deletion of your Akiba Pass account and personal data held by Akiba Ecosystems Ltd.",
  // Indexable on purpose (§6), unlike the policy pages: store reviewers and
  // members need to be able to find this without the app.
  robots: { index: true, follow: true },
};

const SUPPORT_EMAIL = "hello@akibamiles.com";

export default async function AccountDeletionPage() {
  // Reading the session must never make this page fail. A Supabase outage
  // has to leave the information and the support fallback readable.
  let signedIn = false;
  let maskedEmail: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    signedIn = !!user;
    maskedEmail = user?.email ? maskEmail(user.email) : null;
  } catch {
    signedIn = false;
  }

  return (
    <main className="bg-akiba-paper">
      <section className="px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <div className="inline-flex rounded-full bg-white px-4 py-2 text-sm font-medium text-akiba-teal shadow-chip">
            Akiba Ecosystems Ltd · Akiba Pass
          </div>

          <h1 className="mt-6 font-sterling text-4xl font-medium leading-[1.08] text-akiba-ink sm:text-5xl">
            Delete your Akiba Pass account
          </h1>

          <p className="mt-6 text-lg leading-8 text-akiba-muted">
            This page deletes your <strong className="text-akiba-ink">Akiba Pass</strong> account with
            Akiba Ecosystems Ltd — your sign-in, your profile and contact details, your Akiba Pass, your
            saved places, and the personal data connected to them. You can do this here or in the Akiba
            Pass app; both go through the same verification and the same process.
          </p>

          <div className="mt-8">
            <AccountDeletionFlow
              maskedEmail={maskedEmail}
              policyVersion={DELETION_POLICY_VERSION}
              processingTargetDays={PROCESSING_TARGET_DAYS}
              signedIn={signedIn}
              supportEmail={SUPPORT_EMAIL}
            />
          </div>

          <div className="mt-14 space-y-10">
            <section>
              <h2 className="font-sterling text-2xl font-medium text-akiba-ink sm:text-3xl">
                What gets deleted
              </h2>
              <ul className="mt-4 list-disc space-y-2 pl-5 text-base leading-7 text-akiba-muted">
                <li>Your sign-in account and email address.</li>
                <li>Your profile and contact details — username, phone number, city, and avatar.</li>
                <li>Your Akiba Pass and any Pass credentials, so no code of yours can be scanned again.</li>
                <li>Saved places, notification settings, and device registrations.</li>
                <li>The link between your Akiba account and any wallet address you connected.</li>
                <li>Photos and contributions you submitted, including ones not yet published.</li>
              </ul>
            </section>

            <section>
              <h2 className="font-sterling text-2xl font-medium text-akiba-ink sm:text-3xl">
                What happens to your Miles and vouchers
              </h2>
              <p className="mt-4 text-base leading-7 text-akiba-muted">
                Deleting your account ends your access to AkibaMiles earned on it. Your Akiba Pass stops
                working and any voucher you have not yet redeemed becomes unusable. We will not block your
                deletion request because you still hold a balance or an active voucher — but we cannot
                transfer them to another account, and they cannot be restored afterwards.
              </p>
            </section>

            <section>
              <h2 className="font-sterling text-2xl font-medium text-akiba-ink sm:text-3xl">
                What we may have to keep
              </h2>
              <p className="mt-4 text-base leading-7 text-akiba-muted">
                Some records are kept in a pseudonymised form — with your name, email, and other direct
                identifiers removed — where the law or a legitimate purpose requires it. That covers
                transaction and voucher-redemption records, merchant settlement and payment evidence, and
                fraud, security, and audit records. Access to those records is restricted, and each one is
                held only for its approved retention period. We also keep a record that you asked for
                deletion and that we carried it out.
              </p>
            </section>

            <section>
              <h2 className="font-sterling text-2xl font-medium text-akiba-ink sm:text-3xl">
                What Akiba cannot erase
              </h2>
              <p className="mt-4 text-base leading-7 text-akiba-muted">
                Transactions already written to the Celo blockchain, and the public wallet addresses
                involved in them, are permanent and public. No one — including Akiba — can delete or change
                them. Deleting your Akiba account removes our off-chain association with your wallet where
                our retention plan allows it; it does not and cannot remove anything from the blockchain
                itself.
              </p>
            </section>

            <section>
              <h2 className="font-sterling text-2xl font-medium text-akiba-ink sm:text-3xl">
                How long it takes
              </h2>
              <p className="mt-4 text-base leading-7 text-akiba-muted">
                We aim to complete deletion within {PROCESSING_TARGET_DAYS} calendar days of your verified
                request, unless we are legally required to hold the data for longer. You will get a
                confirmation email at your account address when processing finishes. There is no way to
                cancel the request yourself once you have confirmed it.
              </p>
            </section>

            <section>
              <h2 className="font-sterling text-2xl font-medium text-akiba-ink sm:text-3xl">
                If you cannot sign in
              </h2>
              <p className="mt-4 text-base leading-7 text-akiba-muted">
                Verification protects your account from someone else deleting it, so the normal path needs
                access to your account email. If you have lost that access, contact{" "}
                <a className="font-medium text-akiba-tealDark underline" href={`mailto:${SUPPORT_EMAIL}`}>
                  {SUPPORT_EMAIL}
                </a>{" "}
                and we will verify you another way. Email is a fallback for that case only — you do not
                need to email us to delete your account.
              </p>
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}
