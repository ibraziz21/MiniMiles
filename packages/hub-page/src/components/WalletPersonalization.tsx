import { CheckCircle2 } from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";

const reasons = [
  {
    title: "Check campaign eligibility",
    description:
      "Many campaigns require a minimum wallet balance or verified on-chain activity. Connecting lets Akiba check eligibility instantly.",
  },
  {
    title: "Unlock wallet-specific rewards",
    description:
      "MiniPay campaigns are only available to MiniPay holders. Base campaigns require a Base wallet. Connecting unlocks the right tier.",
  },
  {
    title: "Get recommendations tailored to your activity",
    description:
      "Akiba uses your wallet activity and interest choices to surface campaigns that actually match you — not generic offers.",
  },
  {
    title: "You stay in control",
    description:
      "Akiba reads wallet balances and activity for eligibility checks only. You control which wallets you connect and can disconnect at any time.",
  },
];

export function WalletPersonalization() {
  return (
    <section className="bg-akiba-paper px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <SectionHeader
            eyebrow="Why Connect Wallets?"
            title="Your wallet unlocks your rewards"
            body="The public Hub page shows all available campaigns. Inside the app, your connected wallets reveal which campaigns you're eligible for."
          />

          <div className="flex flex-col gap-5">
            {reasons.map((reason) => (
              <div key={reason.title} className="flex gap-4">
                <CheckCircle2
                  className="mt-0.5 h-5 w-5 shrink-0 text-akiba-teal"
                  aria-hidden="true"
                />
                <div>
                  <h3 className="font-sterling text-base font-semibold text-akiba-ink">
                    {reason.title}
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-akiba-muted">{reason.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
