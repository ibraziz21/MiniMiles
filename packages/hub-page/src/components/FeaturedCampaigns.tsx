import { SectionHeader } from "@/components/SectionHeader";
import { CampaignCard } from "@/components/CampaignCard";
import { campaigns } from "@/data/campaigns";
import { AKIBA_HUB_APP_URL } from "@/constants/links";

export function FeaturedCampaigns() {
  return (
    <section id="featured" className="bg-white px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionHeader
          eyebrow="Featured Now"
          title="Explore live and upcoming campaigns"
          body="Browse featured rewards, quests, games, and campaigns. Open the app to check eligibility and claim rewards personalized to your wallets and activity."
          align="center"
        />

        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((campaign) => (
            <CampaignCard key={campaign.id} campaign={campaign} />
          ))}
        </div>

        <div className="mt-10 rounded-lg border border-akiba-line bg-akiba-tint px-6 py-5 text-center">
          <p className="text-sm text-akiba-muted">
            <span className="font-semibold text-akiba-ink">More campaigns available in the app.</span>{" "}
            Connect your MiniPay or Base wallet to see offers personalized to your activity and
            interests.
          </p>
          <a
            href={AKIBA_HUB_APP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-block text-sm font-semibold text-akiba-teal no-underline hover:underline"
          >
            Open Akiba Pass App →
          </a>
        </div>
      </div>
    </section>
  );
}
