import type { Metadata } from "next";
import Link from "next/link";
import { Panel } from "@/components/Panel";
import { FaqAccordion } from "@/components/FaqAccordion";
import { siteConfig } from "@/content/site";

export const metadata: Metadata = {
  title: "Akiba App Support",
  description: "Get help with Akiba sign-in, your Pass, AkibaMiles, vouchers and account deletion.",
  alternates: { canonical: "/support" },
};

const questions = [
  {
    question: "I can’t sign in or haven’t received my code",
    answer: "Check that you entered the email address associated with your Akiba account, then check your spam or junk folder. Use the most recent sign-in code. If you have set a password, you can use the password sign-in option instead. If you still can’t sign in, email us with a description of the problem. Never send us your password or sign-in code.",
  },
  {
    question: "How do I use my Akiba Pass?",
    answer: "Open the Pass tab in the Akiba app and show your QR code to the cashier at a participating merchant. Eligible purchases earn AkibaMiles according to the merchant’s offer. Keep your Pass QR code private except when presenting it to a participating merchant.",
  },
  {
    question: "My Miles are missing or look incorrect",
    answer: "Check your Miles balance and activity in the app. If a purchase is missing or the amount looks wrong, email us with the merchant’s name, the date of your visit and the expected Miles. Keep your receipt available in case we need it to investigate. Please don’t send payment card or bank account details.",
  },
  {
    question: "How do I redeem a voucher?",
    answer: "Open your voucher in the app and follow its redemption instructions at the participating merchant. Check its expiry date, eligible location and any minimum-spend or other terms before redeeming. If a voucher won’t work, contact us with the merchant’s name and the error you see. Don’t email the voucher’s redemption code or QR code.",
  },
  {
    question: "How do I report a visit photo?",
    answer: "Open the verified visit on the merchant’s page and use its report option to flag inappropriate content. You can also email us with the merchant’s name and enough detail to identify the content you’re reporting.",
  },
  {
    question: "The app isn’t working as expected",
    answer: "Check your internet connection, close and reopen Akiba, and make sure you have the latest version from your app store. If the problem continues, email us with your device model, operating system, app version and the steps that led to the issue. Remove personal information and QR codes from any screenshots you share.",
  },
];

const textLink = "rounded-sm underline underline-offset-4 hover:text-akiba-teal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-akiba-ink";

export default function SupportPage() {
  return (
    <main>
      <Panel tone="tint">
        <div className="grid items-start gap-10 lg:grid-cols-[1.2fr_1fr] lg:gap-16">
          <div className="max-w-xl">
            <h1 className="font-sterling text-4xl font-medium leading-tight text-akiba-ink sm:text-6xl">A little help with Akiba.</h1>
            <p className="mt-6 text-lg leading-8 text-akiba-muted">From signing in to redeeming a reward, find answers here or get in touch with our support team.</p>
          </div>
          <div className="border-t border-akiba-teal/30 pt-6">
            <h2 className="font-sterling text-2xl font-medium text-akiba-ink">Contact Akiba support</h2>
            <p className="mt-3 leading-7 text-akiba-muted">Email us from your account email address when possible, and tell us what you need help with. You don’t need to sign in to ask for help.</p>
            <a href={`mailto:${siteConfig.email}`} className={`mt-5 inline-flex min-h-11 items-center break-all text-lg font-semibold text-akiba-ink ${textLink}`}>{siteConfig.email}</a>
            <p className="mt-4 text-sm leading-6 text-akiba-muted">Never share your password, sign-in codes, Pass QR code or voucher redemption codes.</p>
          </div>
        </div>
      </Panel>

      <Panel tone="white">
        <h2 className="mb-8 font-sterling text-3xl font-medium text-akiba-ink sm:text-4xl">Common questions</h2>
        <FaqAccordion items={questions} />
      </Panel>

      <Panel tone="card">
        <div className="max-w-3xl">
          <h2 className="font-sterling text-3xl font-medium text-akiba-ink">Your account and privacy</h2>
          <p className="mt-4 leading-7 text-akiba-muted">To request account deletion, visit the <a href="https://pass.akibamiles.com/account-deletion" className={textLink}>account deletion page</a> and follow the email verification steps. If you can’t access your account email or complete the request, contact support for help.</p>
          <p className="mt-4 leading-7 text-akiba-muted">Learn how your information is handled in our <Link href="/privacy-policy" className={textLink}>Privacy Policy</Link>, or read the <Link href="/terms-of-use" className={textLink}>Terms of Use</Link> for the conditions that apply to Akiba and its rewards.</p>
        </div>
      </Panel>
    </main>
  );
}
