import { redirect } from "next/navigation";
import Link from "next/link";
import { Gamepad2, Zap, Brain, Trophy } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { resolveHubQuestCanonical } from "@/lib/akiba/canonicalPartnerQuests";
import { gamesBackend, GamesBackendError, type Identity } from "@/lib/games/backendClient";
import { isGamesEnabledFor } from "@/lib/games/gamesRollout";
import { MilesIcon } from "@/components/MilesIcon";

// Games home — walletless-pass-skill-games-spec.md §6.2. Only Memory Flip and
// Rule Tap; deliberately does NOT reuse React's GamesHub (which also
// advertises Farkle, CrackPot, Claw, weekly prizes, and ticket entry).
export const metadata = { title: "Games — Akiba Pass" };

type LauncherStatus =
  | { available: true; playsToday: number; playsRemaining: number; dailyCap: number; bestScoreToday: number | null }
  | { available: false };

const GAMES: Array<{
  type: "rule_tap" | "memory_flip";
  name: string;
  description: string;
  route: string;
  gradient: string;
  icon: typeof Zap;
}> = [
  {
    type: "rule_tap",
    name: "Rule Tap",
    description: "Read the rule, tap only the matching tiles, and avoid traps.",
    route: "/games/rule-tap",
    gradient: "from-[#0D7A8A] via-[#238D9D] to-[#1A9AAD]",
    icon: Zap,
  },
  {
    type: "memory_flip",
    name: "Memory Flip",
    description: "Match 8 hidden pairs before time runs out.",
    route: "/games/memory-flip",
    gradient: "from-[#3B1F6E] via-[#5B35A0] to-[#7B4CC0]",
    icon: Brain,
  },
];

async function loadStatus(identity: Identity, gameType: "rule_tap" | "memory_flip"): Promise<LauncherStatus> {
  try {
    const status = await gamesBackend.status(identity, gameType);
    return {
      available: true,
      playsToday: status.playsToday,
      playsRemaining: status.playsRemaining,
      dailyCap: 5,
      bestScoreToday: status.bestScoreToday,
    };
  } catch (err) {
    if (!(err instanceof GamesBackendError)) {
      console.error(`[games] status load failed for ${gameType}:`, err);
    }
    return { available: false };
  }
}

export default async function GamesHomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/games");

  if (!isGamesEnabledFor(user.email ?? user.id)) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <Gamepad2 className="mx-auto mb-3 h-8 w-8 text-akiba-teal/60" />
        <h1 className="font-sterling text-xl font-semibold text-akiba-ink">Games are on their way</h1>
        <p className="mt-2 text-sm text-akiba-muted">
          Free skill games are rolling out to members gradually. Check back soon.
        </p>
      </main>
    );
  }

  const canonicalId = await resolveHubQuestCanonical({ hubUserId: user.id, email: user.email ?? null });
  const identity: Identity = { canonicalId, hubUserId: user.id };

  const [ruleTapStatus, memoryFlipStatus] = await Promise.all([
    loadStatus(identity, "rule_tap"),
    loadStatus(identity, "memory_flip"),
  ]);
  const statusByType = { rule_tap: ruleTapStatus, memory_flip: memoryFlipStatus };

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 pb-24 sm:px-6">
      <div className="mb-6 flex items-center gap-2">
        <Gamepad2 className="h-6 w-6 text-akiba-teal" />
        <div>
          <h1 className="font-sterling text-2xl font-semibold text-akiba-ink">Games</h1>
          <p className="text-sm text-akiba-muted">Play free skill games and earn AkibaMiles — no wallet needed.</p>
        </div>
      </div>

      <div className="space-y-4">
        {GAMES.map((game) => (
          <GameLauncher key={game.type} game={game} status={statusByType[game.type]} />
        ))}
      </div>
    </main>
  );
}

function GameLauncher({
  game,
  status,
}: {
  game: (typeof GAMES)[number];
  status: LauncherStatus;
}) {
  const Icon = game.icon;
  const capped = status.available && status.playsRemaining <= 0;

  return (
    <div className="overflow-hidden rounded-2xl shadow-sm">
      <div className={`relative bg-gradient-to-r ${game.gradient} p-5`}>
        <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-white/10" />
        <div className="absolute right-12 bottom-0 h-12 w-12 rounded-full bg-white/10" />

        <div className="relative z-10">
          <div className="mb-3 flex items-start justify-between">
            <div>
              <div className="mb-1.5 inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-semibold text-white/90">
                <span className="h-1.5 w-1.5 rounded-full bg-[#4EFFA0]" />
                Free to play
              </div>
              <h2 className="text-2xl font-bold text-white">{game.name}</h2>
              <p className="mt-0.5 text-sm text-white/80">{game.description}</p>
            </div>
            <div className="flex-shrink-0 rounded-2xl bg-white/15 p-3">
              <Icon className="h-6 w-6 text-white" />
            </div>
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-white/85">
            <span className="inline-flex items-center gap-1">
              Win up to <MilesIcon className="h-3.5 w-3.5" /> 12
            </span>
            {status.available ? (
              <span>{status.playsToday}/{status.dailyCap} played today</span>
            ) : null}
            {status.available && status.bestScoreToday != null && (
              <span className="inline-flex items-center gap-1">
                <Trophy className="h-3.5 w-3.5" /> Best today: {status.bestScoreToday}
              </span>
            )}
          </div>

          {!status.available ? (
            <div className="w-full rounded-xl bg-white/15 py-3 text-center text-sm font-semibold text-white/70">
              Games are temporarily unavailable — try again shortly
            </div>
          ) : capped ? (
            <div className="w-full rounded-xl bg-white/15 py-3 text-center text-sm font-semibold text-white/70">
              {status.dailyCap}/{status.dailyCap} played today · Come back tomorrow
            </div>
          ) : (
            <Link
              href={game.route}
              className="block w-full rounded-xl bg-white py-3 text-center text-sm font-bold text-[#1A1A1A] transition active:scale-[0.98]"
            >
              Play · {status.playsRemaining} left today
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
