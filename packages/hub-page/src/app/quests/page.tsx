import { Zap, Clock } from "lucide-react";
import { MilesAmount } from "@/components/MilesIcon";
import { createClient } from "@/lib/supabase/server";
import { QuestCard } from "./QuestCard";
import type { Quest, ChainMeta } from "./QuestCard";

export const metadata = { title: "Partner Quests — Akiba Pass" };

// ── Chain metadata ────────────────────────────────────────────────────────────
//
// logoSrc: path inside /public/chains/ — null means show emoji fallback.
// Add a new entry here when a new chain SVG is copied to public/chains/.

const CHAIN_META: Record<string, ChainMeta> = {
  celo:    { label: "Celo",    emoji: "🌱", badgeCls: "bg-green-50 text-green-700",     iconBg: "bg-green-50",    logoSrc: "/chains/celo.svg"    },
  minipay: { label: "MiniPay", emoji: "📱", badgeCls: "bg-akiba-tint text-akiba-teal",  iconBg: "bg-akiba-tint",  logoSrc: "/chains/minipay.svg" },
};

function getChainMeta(chain?: string): ChainMeta & { key: string } {
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

// ── Data fetching ─────────────────────────────────────────────────────────────

async function getQuests(): Promise<Quest[]> {
  const api = process.env.AKIBA_API_URL ?? "http://localhost:3001";
  try {
    const res = await fetch(`${api}/api/v1/hub/quests`, {
      next: { revalidate: 120 },
    });
    if (!res.ok) return [];
    const { quests } = (await res.json()) as { quests?: Quest[] };
    return quests ?? [];
  } catch {
    return [];
  }
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function QuestsPage() {
  const [quests, { data: { user } }] = await Promise.all([
    getQuests(),
    (await createClient()).auth.getUser(),
  ]);

  const isSignedIn = !!user;

  // Group by chain, preserving API insertion order.
  const byChain = new Map<string, Quest[]>();
  for (const q of quests) {
    const key = (q.chain ?? "general").toLowerCase();
    if (!byChain.has(key)) byChain.set(key, []);
    byChain.get(key)!.push(q);
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-5 sm:py-8 sm:px-6 lg:px-8">

      <div className="mb-5 sm:mb-8">
        <h1 className="font-sterling text-2xl font-semibold text-akiba-ink sm:text-3xl">
          Partner Quests
        </h1>
        <p className="mt-1 text-sm text-akiba-muted sm:mt-2">
          Complete on-chain tasks from our partner ecosystem. Earn AkibaMiles for every verified quest.
        </p>
      </div>

      {quests.length === 0 ? (
        <QuestPreview />
      ) : (
        <div className="space-y-10">
          {[...byChain.entries()].map(([chainKey, chainQuests]) => {
            const meta = getChainMeta(chainKey === "general" ? undefined : chainKey);

            // Sub-group by partner within this chain
            const byPartner = new Map<string, Quest[]>();
            for (const q of chainQuests) {
              if (!byPartner.has(q.partner_slug)) byPartner.set(q.partner_slug, []);
              byPartner.get(q.partner_slug)!.push(q);
            }
            const multiPartner = byPartner.size > 1;

            return (
              <section key={chainKey}>

                {/* Chain header */}
                <div className="mb-4 flex items-center gap-3">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl ${meta.iconBg}`}>
                    {meta.logoSrc ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={meta.logoSrc} alt={meta.label} className="h-6 w-6 object-contain" />
                    ) : (
                      <span className="text-lg">{meta.emoji}</span>
                    )}
                  </span>
                  <h2 className="font-sterling text-xl font-semibold text-akiba-ink">
                    {meta.label}
                  </h2>
                  <span className="rounded-full bg-akiba-card px-2.5 py-0.5 text-xs font-medium text-akiba-muted">
                    {chainQuests.length} quest{chainQuests.length !== 1 ? "s" : ""}
                  </span>
                </div>

                {/* Cards */}
                {multiPartner ? (
                  <div className="space-y-6">
                    {[...byPartner.entries()].map(([, pQuests]) => (
                      <div key={pQuests[0].partner_slug}>
                        <p className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-akiba-muted">
                          {pQuests[0].partner_logo && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={pQuests[0].partner_logo}
                              alt=""
                              className="mr-1.5 inline-block h-4 w-4 rounded align-middle object-contain"
                            />
                          )}
                          {pQuests[0].partner_name}
                        </p>
                        <div className="grid gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3">
                          {pQuests.map((q) => (
                            <QuestCard key={q.id} quest={q} chainMeta={meta} isSignedIn={isSignedIn} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {chainQuests.map((q) => (
                      <QuestCard key={q.id} quest={q} chainMeta={meta} isSignedIn={isSignedIn} />
                    ))}
                  </div>
                )}

              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}

// ── Coming-soon preview ───────────────────────────────────────────────────────

const PREVIEW: Array<{
  chain: string;
  quests: Array<{ title: string; desc: string; miles: number }>;
}> = [
  {
    chain: "celo",
    quests: [
      { title: "Daily check-in",   desc: "Check in every day to earn steady rewards.",              miles: 10  },
      { title: "Stake CELO",       desc: "Lock CELO in a validator group for 7+ days.",             miles: 250 },
    ],
  },
  {
    chain: "minipay",
    quests: [
      { title: "Fund your savings",desc: "Save $5 or more in MiniPay.",                             miles: 150 },
      { title: "Refer a friend",   desc: "Invite a friend who completes their first transaction.",  miles: 300 },
    ],
  },
];

function QuestPreview() {
  return (
    <div>
      <div className="mb-6 rounded-2xl border border-dashed border-akiba-teal/30 bg-akiba-tint p-5 text-center sm:p-6">
        <Zap className="mx-auto mb-3 h-8 w-8 text-akiba-teal/60" />
        <p className="font-semibold text-akiba-ink">Partner quests are being configured</p>
        <p className="mt-1 text-sm text-akiba-muted">
          Quests from our partner ecosystem will appear here. Below is a preview of what&apos;s coming.
        </p>
      </div>

      <div className="space-y-8">
        {PREVIEW.map(({ chain, quests }) => {
          const meta = getChainMeta(chain);
          return (
            <section key={chain} className="opacity-50">
              <div className="mb-3 flex items-center gap-3">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-xl ${meta.iconBg}`}>
                  {meta.logoSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={meta.logoSrc} alt={meta.label} className="h-5 w-5 object-contain" />
                  ) : (
                    <span className="text-base">{meta.emoji}</span>
                  )}
                </span>
                <h2 className="font-sterling text-lg font-semibold text-akiba-ink">{meta.label}</h2>
              </div>
              <div className="grid gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {quests.map((q) => (
                  <div key={q.title} className="rounded-2xl border border-akiba-line bg-white p-4 sm:p-5">
                    <span className={`mb-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${meta.badgeCls}`}>
                      {meta.label}
                    </span>
                    <h3 className="font-semibold text-akiba-ink">{q.title}</h3>
                    <p className="mt-1 text-sm text-akiba-muted">{q.desc}</p>
                    <div className="mt-4 flex items-center justify-between">
                      <MilesAmount amount={q.miles} size="sm" prefix="+" className="font-semibold text-akiba-teal" />
                      <span className="flex items-center gap-1 rounded-full bg-akiba-card px-2.5 py-1 text-xs font-medium text-akiba-muted">
                        <Clock className="h-3 w-3" /> Coming soon
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
