import { ArrowUpRight } from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { ButtonLink } from "@/components/ButtonLink";
import { PARTNER_WITH_AKIBA_URL } from "@/constants/links";

const useCases = [
  {
    audience: "Projects",
    icon: "🚀",
    title: "Drive verified user actions",
    description:
      "Launch quests, campaigns, and challenges that reward users for interacting with your project. Reach an engaged audience across MiniPay, Base, and Akiba.",
  },
  {
    audience: "Merchants",
    icon: "🏪",
    title: "Distribute vouchers and promos",
    description:
      "Put your vouchers and promotional offers in front of AkibaMiles users who are actively redeeming rewards. Track conversions and ROI.",
  },
  {
    audience: "Games",
    icon: "🎮",
    title: "Reward players and run gated raffles",
    description:
      "Integrate with Akiba to offer in-game rewards, sponsor leaderboard prizes, or run gated raffles for verified players.",
  },
];

export function PartnerCTA() {
  return (
    <section id="partners" className="bg-white px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="rounded-lg bg-akiba-ink px-6 py-12 text-white sm:px-10 lg:px-14 lg:py-16">
          <div className="mx-auto max-w-3xl text-center">
            <p className="font-sterling text-base font-medium text-[#74D4DF]">For Partners</p>
            <h2 className="mt-3 font-sterling text-4xl font-medium leading-[1.08] sm:text-5xl">
              Launch a reward campaign with Akiba
            </h2>
            <p className="mt-5 text-lg leading-8 text-white/75">
              Projects, merchants, and wallets can use Akiba to reach users through quests,
              vouchers, games, raffles, and personalized reward recommendations.
            </p>
            <ButtonLink
              href={PARTNER_WITH_AKIBA_URL}
              variant="secondary"
              className="mt-8 bg-white"
            >
              Partner With Akiba
            </ButtonLink>
          </div>

          <div className="mt-12 grid gap-5 sm:grid-cols-3">
            {useCases.map((item) => (
              <div
                key={item.audience}
                className="rounded-lg bg-white/5 p-6 ring-1 ring-white/10"
              >
                <div className="flex items-center gap-2">
                  <span className="text-2xl" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span className="inline-flex rounded-full bg-akiba-teal/20 px-2.5 py-1 text-xs font-semibold text-[#74D4DF]">
                    {item.audience}
                  </span>
                </div>
                <h3 className="mt-4 font-sterling text-lg font-medium">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-white/60">{item.description}</p>
                <a
                  href={PARTNER_WITH_AKIBA_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#74D4DF] no-underline hover:text-white"
                >
                  Learn more <ArrowUpRight className="h-4 w-4" />
                </a>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
