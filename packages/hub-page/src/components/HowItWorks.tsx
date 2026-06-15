import { SectionHeader } from "@/components/SectionHeader";
import { ButtonLink } from "@/components/ButtonLink";
import { AKIBA_HUB_APP_URL } from "@/constants/links";

const steps = [
  {
    number: "01",
    title: "Open Akiba Hub",
    description: "Visit hub.akibamiles.com or open the Akiba Hub app on your device.",
  },
  {
    number: "02",
    title: "Log in with OTP",
    description: "Sign in securely with a one-time password sent to your phone. No passwords needed.",
  },
  {
    number: "03",
    title: "Connect your wallets",
    description:
      "Link your MiniPay and/or Base wallet so Akiba can check eligibility for wallet-specific campaigns.",
  },
  {
    number: "04",
    title: "Choose your interests",
    description:
      "Tell Akiba what matters to you — games, DeFi, vouchers, quests — and get a personalized feed.",
  },
  {
    number: "05",
    title: "Get personalized rewards",
    description:
      "See campaigns, raffles, and quests you actually qualify for based on your activity and interests.",
  },
  {
    number: "06",
    title: "Earn, play, redeem, and win",
    description:
      "Collect AkibaMiles, enter raffles, complete quests, redeem vouchers, and win campaign prizes.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="bg-white px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionHeader
          eyebrow="How Akiba Hub Works"
          title="From public discovery to personalized rewards"
          body="This page shows you what's possible. The app makes it personal. Here's how to go from browsing to earning."
          align="center"
        />

        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((step) => (
            <div key={step.number} className="flex gap-4">
              <div className="shrink-0">
                <span className="font-sterling text-3xl font-bold text-akiba-teal/30">
                  {step.number}
                </span>
              </div>
              <div>
                <h3 className="font-sterling text-lg font-semibold text-akiba-ink">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-akiba-muted">{step.description}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-12 text-center">
          <ButtonLink href={AKIBA_HUB_APP_URL}>Open Akiba Hub App</ButtonLink>
        </div>
      </div>
    </section>
  );
}
