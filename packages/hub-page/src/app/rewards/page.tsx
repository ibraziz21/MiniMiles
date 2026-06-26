import { Sparkles, ExternalLink, Clock, Coins } from "lucide-react";

export const metadata = { title: "Rewards & Offers — Akiba Hub" };

// Fetch from Akiba-Platform; graceful fallback to empty
async function getRewards() {
  const AKIBA_API = process.env.AKIBA_API_URL ?? "http://localhost:3001";
  try {
    const res = await fetch(`${AKIBA_API}/api/v1/hub/rewards`, {
      next: { revalidate: 120 },
    });
    if (!res.ok) return [];
    const { rewards } = await res.json();
    return rewards ?? [];
  } catch {
    return [];
  }
}

type Reward = {
  id: string;
  title: string;
  description: string;
  points_value: number;
  chain: string;
  campaign_type: string;
  partner_name?: string;
  partner_logo?: string;
  banner_url?: string;
  ends_at?: string;
  action_url?: string;
};

const CHAIN_COLORS: Record<string, string> = {
  celo: "bg-yellow-50 text-yellow-700",
  base: "bg-blue-50 text-blue-700",
  minipay: "bg-akiba-tint text-akiba-teal",
};

export default async function RewardsPage() {
  const rewards: Reward[] = await getRewards();

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="font-sterling text-3xl font-semibold text-akiba-ink">Rewards & Offers</h1>
        <p className="mt-2 text-akiba-muted">
          Active campaigns across MiniPay, Base, Celo and more. Claim points for on-chain actions.
        </p>
      </div>

      {/* Chain filter strip */}
      <ChainFilter />

      {rewards.length === 0 ? (
        <ComingSoon />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {rewards.map((r) => (
            <RewardCard key={r.id} reward={r} />
          ))}
        </div>
      )}
    </main>
  );
}

function ChainFilter() {
  const chains = [
    { label: "All chains", value: "" },
    { label: "MiniPay", value: "minipay" },
    { label: "Base", value: "base" },
    { label: "Celo", value: "celo" },
  ];
  return (
    <div className="mb-6 flex flex-wrap gap-2">
      {chains.map(({ label }) => (
        <span
          key={label}
          className="cursor-pointer rounded-full border border-akiba-line bg-white px-4 py-1.5 text-sm font-medium text-akiba-muted transition hover:border-akiba-teal/40 hover:text-akiba-teal first:border-akiba-teal first:text-akiba-teal"
        >
          {label}
        </span>
      ))}
    </div>
  );
}

function RewardCard({ reward: r }: { reward: Reward }) {
  const chainStyle = CHAIN_COLORS[r.chain?.toLowerCase()] ?? "bg-akiba-card text-akiba-muted";

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-akiba-line bg-white">
      {r.banner_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={r.banner_url} alt={r.title} className="h-32 w-full object-cover" />
      )}
      {!r.banner_url && (
        <div className="flex h-24 items-center justify-center bg-gradient-to-br from-akiba-tint to-white">
          <Sparkles className="h-8 w-8 text-akiba-teal/40" />
        </div>
      )}

      <div className="flex flex-1 flex-col p-4">
        <div className="mb-2 flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${chainStyle}`}>
            {r.chain}
          </span>
          <span className="rounded-full bg-akiba-card px-2 py-0.5 text-[11px] text-akiba-muted">
            {r.campaign_type}
          </span>
        </div>

        <h3 className="font-semibold text-akiba-ink">{r.title}</h3>
        <p className="mt-1 flex-1 text-sm leading-relaxed text-akiba-muted">{r.description}</p>

        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-akiba-teal">
            <Coins className="h-4 w-4" />
            +{r.points_value.toLocaleString()} miles
          </div>
          {r.ends_at && (
            <span className="flex items-center gap-1 text-xs text-akiba-muted">
              <Clock className="h-3 w-3" />
              {new Date(r.ends_at).toLocaleDateString("en-KE", { month: "short", day: "numeric" })}
            </span>
          )}
        </div>

        {r.action_url && (
          <a
            href={r.action_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 flex items-center justify-center gap-1.5 rounded-xl bg-akiba-teal py-2.5 text-sm font-semibold text-white transition hover:bg-[#1E7E8D]"
          >
            Claim reward <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </div>
  );
}

function ComingSoon() {
  const PREVIEW_CHAINS = [
    { chain: "MiniPay", color: "from-akiba-tint", icon: "📱", desc: "MiniPay savings quests" },
    { chain: "Base", color: "from-blue-50", icon: "🔵", desc: "Base onchain summer rewards" },
    { chain: "Celo", color: "from-yellow-50", icon: "🌱", desc: "Celo ecosystem campaigns" },
  ];

  return (
    <div>
      <div className="mb-6 rounded-2xl border border-dashed border-akiba-teal/30 bg-akiba-tint p-6 text-center">
        <Sparkles className="mx-auto mb-3 h-8 w-8 text-akiba-teal/60" />
        <p className="font-semibold text-akiba-ink">Cross-chain rewards are being set up</p>
        <p className="mt-1 text-sm text-akiba-muted">
          Campaigns from our partner networks will appear here. Below is a preview of what&apos;s coming.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {PREVIEW_CHAINS.map(({ chain, color, icon, desc }) => (
          <div
            key={chain}
            className={`relative overflow-hidden rounded-2xl border border-akiba-line bg-gradient-to-br ${color} to-white p-5 opacity-60`}
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="text-2xl">{icon}</span>
              <span className="font-semibold text-akiba-ink">{chain}</span>
            </div>
            <p className="text-sm text-akiba-muted">{desc}</p>
            <span className="mt-3 inline-flex items-center gap-1 rounded-full bg-white/60 px-3 py-1 text-xs font-medium text-akiba-muted">
              <Clock className="h-3 w-3" /> Coming soon
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
