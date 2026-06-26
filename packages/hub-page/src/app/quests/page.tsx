import { Zap, Clock, ExternalLink, CheckCircle2 } from "lucide-react";
import { MilesAmount } from "@/components/MilesIcon";

export const metadata = { title: "Partner Quests — Akiba Hub" };

async function getQuests() {
  const AKIBA_API = process.env.AKIBA_API_URL ?? "http://localhost:3001";
  try {
    const res = await fetch(`${AKIBA_API}/api/v1/hub/quests`, {
      next: { revalidate: 120 },
    });
    if (!res.ok) return [];
    const { quests } = await res.json();
    return quests ?? [];
  } catch {
    return [];
  }
}

type Quest = {
  id: string;
  title: string;
  description: string;
  miles_reward: number;
  partner_name: string;
  partner_slug: string;
  partner_logo?: string;
  chain?: string;
  difficulty?: "easy" | "medium" | "hard";
  ends_at?: string;
  action_url?: string;
  completed?: boolean;
};

const DIFFICULTY_BADGE: Record<string, string> = {
  easy: "bg-green-50 text-green-700",
  medium: "bg-amber-50 text-amber-700",
  hard: "bg-red-50 text-red-700",
};

// Preview placeholders when no quests loaded
const PREVIEW_PARTNERS = [
  {
    name: "MiniPay",
    logo: "📱",
    quests: [
      { title: "Fund your MiniPay savings", desc: "Save $5 or more in MiniPay.", miles: 150 },
      { title: "Refer a friend", desc: "Invite a friend who completes a transaction.", miles: 300 },
    ],
  },
  {
    name: "Base",
    logo: "🔵",
    quests: [
      { title: "Deploy on Base", desc: "Deploy any smart contract on Base mainnet.", miles: 500 },
      { title: "Bridge to Base", desc: "Bridge at least $10 to Base via the official bridge.", miles: 200 },
    ],
  },
  {
    name: "Celo",
    logo: "🌱",
    quests: [
      { title: "Stake CELO", desc: "Lock CELO in a validator group for 7+ days.", miles: 250 },
      { title: "Use a Celo dApp", desc: "Interact with any Celo ecosystem dApp.", miles: 100 },
    ],
  },
];

export default async function QuestsPage() {
  const quests: Quest[] = await getQuests();

  // Group by partner
  const byPartner = quests.reduce<Record<string, Quest[]>>((acc, q) => {
    if (!acc[q.partner_slug]) acc[q.partner_slug] = [];
    acc[q.partner_slug].push(q);
    return acc;
  }, {});
  const partnerGroups = Object.entries(byPartner);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="font-sterling text-3xl font-semibold text-akiba-ink">Partner Quests</h1>
        <p className="mt-2 text-akiba-muted">
          Complete tasks from our partner ecosystem. Earn AkibaMiles for every verified quest.
        </p>
      </div>

      {quests.length === 0 ? (
        <QuestPreview />
      ) : (
        <div className="space-y-10">
          {partnerGroups.map(([slug, pQuests]) => {
            const first = pQuests[0];
            return (
              <section key={slug}>
                <div className="mb-4 flex items-center gap-3">
                  {first.partner_logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={first.partner_logo} alt={first.partner_name} className="h-8 w-8 rounded-lg object-contain" />
                  ) : (
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-akiba-teal/10 text-akiba-teal">
                      <Zap className="h-4 w-4" />
                    </div>
                  )}
                  <h2 className="font-sterling text-xl font-semibold text-akiba-ink">
                    {first.partner_name}
                  </h2>
                  <span className="rounded-full bg-akiba-card px-2.5 py-0.5 text-xs font-medium text-akiba-muted">
                    {pQuests.length} quest{pQuests.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {pQuests.map((q) => (
                    <QuestCard key={q.id} quest={q} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}

function QuestCard({ quest: q }: { quest: Quest }) {
  return (
    <div
      className={`flex flex-col rounded-2xl border bg-white p-5 transition ${
        q.completed
          ? "border-green-200 bg-green-50/30"
          : "border-akiba-line hover:border-akiba-teal/40 hover:shadow-chip"
      }`}
    >
      <div className="mb-2 flex items-center gap-2">
        {q.completed && <CheckCircle2 className="h-4 w-4 text-green-500" />}
        {q.difficulty && (
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${DIFFICULTY_BADGE[q.difficulty] ?? "bg-akiba-card text-akiba-muted"}`}>
            {q.difficulty}
          </span>
        )}
        {q.chain && (
          <span className="rounded-full bg-akiba-card px-2 py-0.5 text-[11px] text-akiba-muted">
            {q.chain}
          </span>
        )}
      </div>

      <h3 className="font-semibold text-akiba-ink">{q.title}</h3>
      <p className="mt-1 flex-1 text-sm leading-relaxed text-akiba-muted">{q.description}</p>

      <div className="mt-4 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-akiba-teal">
          <MilesAmount amount={q.miles_reward} size="sm" prefix="+" className="text-akiba-teal" />
        </span>
        {q.ends_at && (
          <span className="flex items-center gap-1 text-xs text-akiba-muted">
            <Clock className="h-3 w-3" />
            {new Date(q.ends_at).toLocaleDateString("en-KE", { month: "short", day: "numeric" })}
          </span>
        )}
      </div>

      {q.action_url && !q.completed && (
        <a
          href={q.action_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 flex items-center justify-center gap-1.5 rounded-xl bg-akiba-ink py-2.5 text-sm font-semibold text-white transition hover:bg-akiba-teal"
        >
          Start quest <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}

      {q.completed && (
        <div className="mt-3 flex items-center justify-center gap-1.5 rounded-xl bg-green-100 py-2.5 text-sm font-semibold text-green-700">
          <CheckCircle2 className="h-4 w-4" /> Completed
        </div>
      )}
    </div>
  );
}

function QuestPreview() {
  return (
    <div>
      <div className="mb-6 rounded-2xl border border-dashed border-akiba-teal/30 bg-akiba-tint p-6 text-center">
        <Zap className="mx-auto mb-3 h-8 w-8 text-akiba-teal/60" />
        <p className="font-semibold text-akiba-ink">Partner quests are being configured</p>
        <p className="mt-1 text-sm text-akiba-muted">
          Quests from our partner network will appear here. Below is a preview of what&apos;s coming.
        </p>
      </div>

      <div className="space-y-8">
        {PREVIEW_PARTNERS.map(({ name, logo, quests }) => (
          <section key={name}>
            <div className="mb-3 flex items-center gap-2">
              <span className="text-xl">{logo}</span>
              <h2 className="font-sterling text-xl font-semibold text-akiba-ink">{name}</h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 opacity-50">
              {quests.map((q) => (
                <div
                  key={q.title}
                  className="rounded-2xl border border-akiba-line bg-white p-5"
                >
                  <h3 className="font-semibold text-akiba-ink">{q.title}</h3>
                  <p className="mt-1 text-sm text-akiba-muted">{q.desc}</p>
                  <div className="mt-4 flex items-center gap-1.5 text-sm font-semibold text-akiba-teal">
                    <MilesAmount amount={q.miles} size="sm" prefix="+" className="text-akiba-teal" />
                  </div>
                  <div className="mt-3 flex items-center justify-center gap-1.5 rounded-xl bg-akiba-card py-2.5 text-sm font-semibold text-akiba-muted">
                    <Clock className="h-3.5 w-3.5" /> Coming soon
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
