// Chain/partner metadata for the retained (unmounted) partner-quest section
// (merchant-shopping-quests-spec.md §7 "Partner inventory retention").
// Extracted out of page.tsx so it can be reused without pulling in the rest
// of the page when SHOW_PARTNER_QUESTS is enabled again.
export type ChainMeta = {
  label: string;
  emoji: string;
  badgeCls: string;
  iconBg: string;
  logoSrc: string | null;
};

const CHAIN_META: Record<string, ChainMeta> = {
  celo:    { label: "Celo",    emoji: "🌱", badgeCls: "bg-green-50 text-green-700",     iconBg: "bg-green-50",    logoSrc: "/chains/celo.svg"    },
  minipay: { label: "MiniPay", emoji: "📱", badgeCls: "bg-akiba-tint text-akiba-teal",  iconBg: "bg-akiba-tint",  logoSrc: "/chains/minipay.svg" },
};

export function getChainMeta(chain?: string): ChainMeta & { key: string } {
  const key = (chain ?? "general").toLowerCase();
  const fallback: ChainMeta = {
    label:    chain ? chain.charAt(0).toUpperCase() + chain.slice(1) : "General",
    emoji:    "⚡",
    badgeCls: "bg-akiba-card text-akiba-muted",
    iconBg:   "bg-akiba-card",
    logoSrc:  null,
  };
  return { ...(CHAIN_META[key] ?? fallback), key };
}
