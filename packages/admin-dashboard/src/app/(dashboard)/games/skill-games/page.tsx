import { redirect } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Coins,
  Gamepad2,
  ShieldAlert,
  Trophy,
} from "lucide-react";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/shell/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/ui/metric-card";
import { EmptyState } from "@/components/ui/empty-state";
import { cn, formatDateTime, formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

const LOOKBACK_DAYS = 30;
const TREND_DAYS = 14;
const ROW_LIMIT = 10000;
const MAX_SETTLE_ATTEMPTS = 12;

const GAME_LABELS: Record<string, string> = {
  rule_tap: "Rule Tap",
  memory_flip: "Memory Flip",
};

type BadgeVariant = "default" | "secondary" | "success" | "warning" | "destructive" | "outline";

interface SkillGameSessionRow {
  session_id: string;
  wallet_address: string;
  game_type: string;
  score: number | null;
  reward_miles: number | null;
  reward_stable: number | string | null;
  accepted: boolean | null;
  anti_abuse_flags: string[] | null;
  seed_commitment: string | null;
  settle_tx_hash: string | null;
  settle_attempts: number | null;
  settled_at: string | null;
  settlement_sig: string | null;
  settlement_expiry: number | string | null;
  created_at: string;
}

interface AggregateStats {
  starts: number;
  accepted: number;
  rejected: number;
  unsubmitted: number;
  settled: number;
  pending: number;
  expiredPending: number;
  reviewQueue: number;
  flagged: number;
  uniquePlayers: number;
  rewardMiles: number;
  rewardStable: number;
  avgScore: number;
  topScore: number;
  avgSettlementMinutes: number | null;
}

interface TopPlayer {
  wallet: string;
  games: Set<string>;
  starts: number;
  accepted: number;
  settled: number;
  pending: number;
  rewardMiles: number;
  rewardStable: number;
  bestScore: number;
  lastPlayedAt: string;
}

function getSinceIso(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function numeric(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getFlags(row: SkillGameSessionRow): string[] {
  return Array.isArray(row.anti_abuse_flags) ? row.anti_abuse_flags.filter(Boolean) : [];
}

function isAccepted(row: SkillGameSessionRow) {
  return row.accepted === true;
}

function isSettled(row: SkillGameSessionRow) {
  return isAccepted(row) && Boolean(row.settled_at || row.settle_tx_hash);
}

function isPendingSettlement(row: SkillGameSessionRow) {
  return isAccepted(row) && !isSettled(row);
}

function isExpired(row: SkillGameSessionRow, nowSeconds: number) {
  const expiry = numeric(row.settlement_expiry);
  return isPendingSettlement(row) && expiry > 0 && expiry <= nowSeconds;
}

function isReviewQueue(row: SkillGameSessionRow, nowSeconds: number) {
  return isPendingSettlement(row) && ((row.settle_attempts ?? 0) >= MAX_SETTLE_ATTEMPTS || isExpired(row, nowSeconds));
}

function isUnsubmitted(row: SkillGameSessionRow) {
  return !isAccepted(row) && numeric(row.score) === 0 && getFlags(row).length === 0;
}

function isRejected(row: SkillGameSessionRow) {
  return !isAccepted(row) && !isUnsubmitted(row);
}

function gameLabel(gameType: string) {
  return GAME_LABELS[gameType] ?? gameType.replaceAll("_", " ");
}

function shortWallet(wallet: string | null | undefined) {
  if (!wallet) return "unknown";
  if (wallet.length <= 12) return wallet;
  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
}

function formatPercent(part: number, whole: number) {
  if (!whole) return "0.0%";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

function formatStable(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatMinutes(minutes: number | null) {
  if (minutes == null || !Number.isFinite(minutes)) return "n/a";
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function ageFromNow(iso: string | null | undefined) {
  if (!iso) return "n/a";
  const createdMs = new Date(iso).getTime();
  if (!Number.isFinite(createdMs)) return "n/a";
  const minutes = Math.max(0, (Date.now() - createdMs) / 60000);
  return formatMinutes(minutes);
}

function buildAggregate(rows: SkillGameSessionRow[], nowSeconds: number): AggregateStats {
  const players = new Set<string>();
  let accepted = 0;
  let rejected = 0;
  let unsubmitted = 0;
  let settled = 0;
  let pending = 0;
  let expiredPending = 0;
  let reviewQueue = 0;
  let flagged = 0;
  let rewardMiles = 0;
  let rewardStable = 0;
  let scoreTotal = 0;
  let scoreCount = 0;
  let topScore = 0;
  let settlementMinutesTotal = 0;
  let settlementCount = 0;

  for (const row of rows) {
    const wallet = row.wallet_address?.toLowerCase();
    if (wallet) players.add(wallet);

    if (isAccepted(row)) accepted++;
    if (isRejected(row)) rejected++;
    if (isUnsubmitted(row)) unsubmitted++;
    if (isSettled(row)) settled++;
    if (isPendingSettlement(row)) pending++;
    if (isExpired(row, nowSeconds)) expiredPending++;
    if (isReviewQueue(row, nowSeconds)) reviewQueue++;
    if (getFlags(row).length > 0) flagged++;

    rewardMiles += numeric(row.reward_miles);
    rewardStable += numeric(row.reward_stable);

    const score = numeric(row.score);
    if (isAccepted(row)) {
      scoreTotal += score;
      scoreCount++;
      topScore = Math.max(topScore, score);
    }

    if (row.created_at && row.settled_at) {
      const createdMs = new Date(row.created_at).getTime();
      const settledMs = new Date(row.settled_at).getTime();
      if (Number.isFinite(createdMs) && Number.isFinite(settledMs) && settledMs >= createdMs) {
        settlementMinutesTotal += (settledMs - createdMs) / 60000;
        settlementCount++;
      }
    }
  }

  return {
    starts: rows.length,
    accepted,
    rejected,
    unsubmitted,
    settled,
    pending,
    expiredPending,
    reviewQueue,
    flagged,
    uniquePlayers: players.size,
    rewardMiles,
    rewardStable,
    avgScore: scoreCount ? scoreTotal / scoreCount : 0,
    topScore,
    avgSettlementMinutes: settlementCount ? settlementMinutesTotal / settlementCount : null,
  };
}

function buildDailyTrend(rows: SkillGameSessionRow[]) {
  const days = Array.from({ length: TREND_DAYS }, (_, index) => {
    const date = new Date(Date.now() - (TREND_DAYS - 1 - index) * 24 * 60 * 60 * 1000);
    return date.toISOString().slice(0, 10);
  });
  const trend: Record<string, { day: string; starts: number; accepted: number; settled: number; flagged: number }> = {};
  for (const day of days) {
    trend[day] = { day, starts: 0, accepted: 0, settled: 0, flagged: 0 };
  }
  for (const row of rows) {
    const day = row.created_at?.slice(0, 10);
    if (!trend[day]) continue;
    trend[day].starts++;
    if (isAccepted(row)) trend[day].accepted++;
    if (isSettled(row)) trend[day].settled++;
    if (getFlags(row).length > 0) trend[day].flagged++;
  }
  return days.map((day) => trend[day]);
}

function buildFlagCounts(rows: SkillGameSessionRow[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const flag of getFlags(row)) {
      counts.set(flag, (counts.get(flag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([flag, count]) => ({ flag, count }));
}

function buildTopPlayers(rows: SkillGameSessionRow[]) {
  const players = new Map<string, TopPlayer>();
  for (const row of rows) {
    const wallet = row.wallet_address?.toLowerCase();
    if (!wallet) continue;
    const current =
      players.get(wallet) ??
      {
        wallet: row.wallet_address,
        games: new Set<string>(),
        starts: 0,
        accepted: 0,
        settled: 0,
        pending: 0,
        rewardMiles: 0,
        rewardStable: 0,
        bestScore: 0,
        lastPlayedAt: row.created_at,
      };

    current.starts++;
    current.games.add(row.game_type);
    current.rewardMiles += numeric(row.reward_miles);
    current.rewardStable += numeric(row.reward_stable);
    current.bestScore = Math.max(current.bestScore, numeric(row.score));
    if (isAccepted(row)) current.accepted++;
    if (isSettled(row)) current.settled++;
    if (isPendingSettlement(row)) current.pending++;
    if (new Date(row.created_at).getTime() > new Date(current.lastPlayedAt).getTime()) {
      current.lastPlayedAt = row.created_at;
    }
    players.set(wallet, current);
  }

  return [...players.values()]
    .sort((a, b) => b.rewardMiles - a.rewardMiles || b.accepted - a.accepted || b.bestScore - a.bestScore)
    .slice(0, 10);
}

function settlementBadge(row: SkillGameSessionRow, nowSeconds: number): { label: string; variant: BadgeVariant } {
  if (!isAccepted(row)) {
    if (isUnsubmitted(row)) return { label: "not submitted", variant: "secondary" };
    return { label: "rejected", variant: "destructive" };
  }
  if (isSettled(row)) return { label: "settled", variant: "success" };
  if ((row.settle_attempts ?? 0) >= MAX_SETTLE_ATTEMPTS) return { label: "max attempts", variant: "destructive" };
  if (isExpired(row, nowSeconds)) return { label: "expired", variant: "warning" };
  if ((row.settle_attempts ?? 0) > 0) return { label: "retrying", variant: "warning" };
  return { label: "pending", variant: "default" };
}

async function getSkillGameSessions(): Promise<{ rows: SkillGameSessionRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from("skill_game_sessions")
    .select(
      "session_id, wallet_address, game_type, score, reward_miles, reward_stable, accepted, anti_abuse_flags, seed_commitment, settle_tx_hash, settle_attempts, settled_at, settlement_sig, settlement_expiry, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(ROW_LIMIT);

  return {
    rows: (data ?? []) as unknown as SkillGameSessionRow[],
    error: error?.message ?? null,
  };
}

function CompactMetric({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-card border border-border bg-surface-subtle px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wider text-ink-muted">{label}</p>
      <p className="mt-1 text-sm font-semibold text-ink">{typeof value === "number" ? formatNumber(value) : value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-muted">{sub}</p>}
    </div>
  );
}

function ProgressLine({ value, total, className }: { value: number; total: number; className?: string }) {
  const width = total > 0 ? Math.min(100, Math.max(0, (value / total) * 100)) : 0;
  return (
    <div className="h-2 overflow-hidden rounded-full bg-surface-subtle">
      <div className={cn("h-full rounded-full bg-primary", className)} style={{ width: `${width}%` }} />
    </div>
  );
}

export default async function SkillGamesOpsPage() {
  const session = await requireAdminSession("orders.read");
  if (!session) redirect("/login");

  const { rows, error } = await getSkillGameSessions();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const stats = buildAggregate(rows, nowSeconds);
  const dailyTrend = buildDailyTrend(rows);
  const maxDailyStarts = Math.max(1, ...dailyTrend.map((day) => day.starts));
  const flagCounts = buildFlagCounts(rows);
  const topPlayers = buildTopPlayers(rows);
  const recentSessions = rows.slice(0, 25);
  const recentFlagged = rows.filter((row) => getFlags(row).length > 0).slice(0, 8);
  const pendingRows = rows.filter(isPendingSettlement);
  const oldestPending = pendingRows.reduce<SkillGameSessionRow | null>((oldest, row) => {
    if (!oldest) return row;
    return new Date(row.created_at).getTime() < new Date(oldest.created_at).getTime() ? row : oldest;
  }, null);

  const gameTypes = [...new Set(["rule_tap", "memory_flip", ...rows.map((row) => row.game_type)])];
  const gameStats = gameTypes.map((gameType) => ({
    gameType,
    stats: buildAggregate(rows.filter((row) => row.game_type === gameType), nowSeconds),
  }));

  return (
    <div>
      <PageHeader title="Skill Games" subtitle={`All time · skill_game_sessions (daily trend: last ${TREND_DAYS} days)`} />

      <div className="space-y-6 p-4 sm:p-6">
        {error && (
          <div className="flex items-start gap-3 rounded-card border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">Could not read skill game sessions.</p>
              <p className="mt-0.5 text-danger">{error}</p>
            </div>
          </div>
        )}

        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-muted">Reward Settlement</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Started Sessions" value={formatNumber(stats.starts)} icon={Gamepad2} sub={`${stats.uniquePlayers} unique wallets`} />
            <MetricCard
              label="Accepted Results"
              value={formatNumber(stats.accepted)}
              icon={CheckCircle2}
              sub={`${formatPercent(stats.accepted, stats.starts)} acceptance rate`}
              tone="success"
            />
            <MetricCard
              label="Pending Rewards"
              value={formatNumber(stats.pending)}
              icon={Clock3}
              sub={oldestPending ? `Oldest pending ${ageFromNow(oldestPending.created_at)}` : "No pending accepted rewards"}
              tone={stats.pending > 0 ? "warning" : "neutral"}
              tintCard={stats.pending > 0}
            />
            <MetricCard
              label="Review Queue"
              value={formatNumber(stats.reviewQueue)}
              icon={AlertTriangle}
              sub={`${stats.expiredPending} expired settlement payloads`}
              tone={stats.reviewQueue > 0 ? "danger" : "neutral"}
              tintCard={stats.reviewQueue > 0}
            />
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-muted">Payout Exposure</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Miles Awarded" value={formatNumber(stats.rewardMiles)} icon={Coins} sub="Accepted and rejected rows included as stored" />
            <MetricCard label="Stable Awards" value={formatStable(stats.rewardStable)} icon={Coins} sub="Stable reward liability in session rows" />
            <MetricCard label="Avg Settlement Time" value={formatMinutes(stats.avgSettlementMinutes)} icon={Activity} sub={`${stats.settled} settled results`} />
            <MetricCard
              label="Flagged Sessions"
              value={formatNumber(stats.flagged)}
              icon={ShieldAlert}
              sub={`${formatPercent(stats.flagged, stats.starts)} of starts`}
              tone={stats.flagged > 0 ? "warning" : "neutral"}
              tintCard={stats.flagged > 0}
            />
          </div>
        </section>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(360px,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle>Game Split</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {gameStats.map(({ gameType, stats: game }) => (
                <div key={gameType} className="rounded-card border border-border p-4">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-ink">{gameLabel(gameType)}</p>
                      <p className="mt-0.5 text-xs text-ink-muted">
                        {formatPercent(game.accepted, game.starts)} accepted, {formatPercent(game.settled, game.accepted)} settled
                      </p>
                    </div>
                    <Badge variant={game.pending > 0 ? "warning" : "secondary"}>{game.pending} pending</Badge>
                  </div>
                  <div className="mb-4 grid gap-3 sm:grid-cols-4">
                    <CompactMetric label="Starts" value={game.starts} />
                    <CompactMetric label="Accepted" value={game.accepted} />
                    <CompactMetric label="Avg score" value={game.avgScore.toFixed(1)} sub={`Top ${formatNumber(game.topScore)}`} />
                    <CompactMetric label="Rewards" value={formatNumber(game.rewardMiles)} sub={formatStable(game.rewardStable)} />
                  </div>
                  <div className="grid gap-3 text-xs text-ink-muted sm:grid-cols-3">
                    <div>
                      <div className="mb-1 flex justify-between">
                        <span>Accepted</span>
                        <span>{game.accepted}/{game.starts}</span>
                      </div>
                      <ProgressLine value={game.accepted} total={game.starts} />
                    </div>
                    <div>
                      <div className="mb-1 flex justify-between">
                        <span>Settled</span>
                        <span>{game.settled}/{game.accepted}</span>
                      </div>
                      <ProgressLine value={game.settled} total={game.accepted} className="bg-success" />
                    </div>
                    <div>
                      <div className="mb-1 flex justify-between">
                        <span>Flagged</span>
                        <span>{game.flagged}/{game.starts}</span>
                      </div>
                      <ProgressLine value={game.flagged} total={game.starts} className="bg-warning" />
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Settlement Analysis</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <CompactMetric label="Settled" value={`${stats.settled}/${stats.accepted}`} sub={`${formatPercent(stats.settled, stats.accepted)} of accepted`} />
              <CompactMetric label="Unsubmitted starts" value={stats.unsubmitted} sub="Started rows without verified replay data" />
              <CompactMetric label="Rejected verifies" value={stats.rejected} sub="Failed replay or anti-abuse checks" />
              <CompactMetric
                label="Ticket revenue"
                value="On-chain only"
                sub="Use CreditsPurchased/CreditConsumed events or Dune for revenue and ARPPU."
              />
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(360px,1fr)_minmax(0,1.4fr)]">
          <Card>
            <CardHeader>
              <CardTitle>Anti-Abuse Flags</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden rounded-card border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-subtle text-xs font-medium uppercase tracking-wider text-ink-muted">
                      <th className="px-4 py-3 text-left">Flag</th>
                      <th className="px-4 py-3 text-right">Count</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {flagCounts.length === 0 && (
                      <tr>
                        <td colSpan={2} className="px-4 py-8 text-center text-ink-muted">
                          No anti-abuse flags in this window.
                        </td>
                      </tr>
                    )}
                    {flagCounts.slice(0, 12).map((flag) => (
                      <tr key={flag.flag}>
                        <td className="px-4 py-3">
                          <Badge variant="warning">{flag.flag}</Badge>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-ink">{formatNumber(flag.count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Daily Trend</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {dailyTrend.map((day) => (
                <div key={day.day} className="grid grid-cols-[88px_minmax(0,1fr)_110px] items-center gap-3 text-sm">
                  <span className="font-mono text-xs text-ink-muted">{day.day.slice(5)}</span>
                  <div>
                    <ProgressLine value={day.starts} total={maxDailyStarts} />
                    <div className="mt-1 flex gap-3 text-[11px] text-ink-muted">
                      <span>{day.accepted} accepted</span>
                      <span>{day.settled} settled</span>
                      <span>{day.flagged} flagged</span>
                    </div>
                  </div>
                  <span className="text-right font-mono text-xs text-ink">{day.starts} starts</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Top Players by Rewards</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden rounded-card border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-subtle text-xs font-medium uppercase tracking-wider text-ink-muted">
                      <th className="px-4 py-3 text-left">Wallet</th>
                      <th className="px-4 py-3 text-left">Games</th>
                      <th className="px-4 py-3 text-right">Sessions</th>
                      <th className="px-4 py-3 text-right">Rewards</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {topPlayers.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-ink-muted">
                          No players found.
                        </td>
                      </tr>
                    )}
                    {topPlayers.map((player) => (
                      <tr key={player.wallet} className="hover:bg-surface-subtle">
                        <td className="px-4 py-3">
                          <p className="font-mono text-xs text-ink">{shortWallet(player.wallet)}</p>
                          <p className="text-xs text-ink-muted">Best score {formatNumber(player.bestScore)}</p>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {[...player.games].map((game) => (
                              <Badge key={game} variant="secondary">{gameLabel(game)}</Badge>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-ink">
                          {formatNumber(player.starts)}
                          <p className="text-xs text-ink-muted">{player.pending} pending</p>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-ink">
                          {formatNumber(player.rewardMiles)} mi
                          <p className="text-xs text-ink-muted">{formatStable(player.rewardStable)}</p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent Flagged Sessions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden rounded-card border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-subtle text-xs font-medium uppercase tracking-wider text-ink-muted">
                      <th className="px-4 py-3 text-left">Session</th>
                      <th className="px-4 py-3 text-left">Flags</th>
                      <th className="px-4 py-3 text-right">Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {recentFlagged.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-4 py-8 text-center text-ink-muted">
                          No flagged sessions found.
                        </td>
                      </tr>
                    )}
                    {recentFlagged.map((row) => (
                      <tr key={row.session_id} className="hover:bg-surface-subtle">
                        <td className="px-4 py-3">
                          <p className="font-mono text-xs text-ink">{row.session_id.slice(0, 12)}</p>
                          <p className="text-xs text-ink-muted">{shortWallet(row.wallet_address)} - {gameLabel(row.game_type)}</p>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {getFlags(row).map((flag) => (
                              <Badge key={flag} variant="warning">{flag}</Badge>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-ink">{formatNumber(numeric(row.score))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>

        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-muted">Recent Sessions</h2>
          {recentSessions.length === 0 ? (
            <EmptyState message={`No skill game sessions found in the last ${LOOKBACK_DAYS} days.`} isHealthy={false} />
          ) : (
            <>
              {/* Mobile: cards */}
              <div className="space-y-3 lg:hidden">
                {recentSessions.map((row) => {
                  const badge = settlementBadge(row, nowSeconds);
                  return (
                    <div key={row.session_id} className="rounded-card border border-border bg-surface p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-mono text-xs text-ink">{row.session_id.slice(0, 12)}</p>
                          <p className="text-xs text-ink-muted">{shortWallet(row.wallet_address)} · {gameLabel(row.game_type)}</p>
                        </div>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </div>
                      <p className="mt-2 text-sm text-ink">
                        Score {formatNumber(numeric(row.score))} · {formatNumber(numeric(row.reward_miles))} mi ({formatStable(numeric(row.reward_stable))})
                      </p>
                      <p className="mt-1 text-xs text-ink-muted">
                        {row.settle_attempts ?? 0} attempts · {formatDateTime(row.created_at)}
                        {getFlags(row).length > 0 && <span className="text-warning"> · {getFlags(row).length} flag(s)</span>}
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* Desktop: table */}
              <div className="hidden overflow-hidden rounded-card border border-border bg-surface lg:block">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-surface-subtle text-xs font-medium uppercase tracking-wider text-ink-muted">
                        <th className="px-4 py-3 text-left">Session</th>
                        <th className="px-4 py-3 text-left">Wallet</th>
                        <th className="px-4 py-3 text-left">Game</th>
                        <th className="px-4 py-3 text-right">Score</th>
                        <th className="px-4 py-3 text-right">Reward</th>
                        <th className="px-4 py-3 text-left">Settlement</th>
                        <th className="px-4 py-3 text-left">Created</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {recentSessions.map((row) => {
                        const badge = settlementBadge(row, nowSeconds);
                        return (
                          <tr key={row.session_id} className="hover:bg-surface-subtle">
                            <td className="px-4 py-3">
                              <p className="font-mono text-xs text-ink">{row.session_id.slice(0, 12)}</p>
                              {getFlags(row).length > 0 && (
                                <p className="mt-1 text-xs text-warning">{getFlags(row).length} flag(s)</p>
                              )}
                            </td>
                            <td className="px-4 py-3 font-mono text-xs text-ink">{shortWallet(row.wallet_address)}</td>
                            <td className="px-4 py-3 text-ink">{gameLabel(row.game_type)}</td>
                            <td className="px-4 py-3 text-right font-mono text-ink">{formatNumber(numeric(row.score))}</td>
                            <td className="px-4 py-3 text-right font-mono text-ink">
                              {formatNumber(numeric(row.reward_miles))} mi
                              <p className="text-xs text-ink-muted">{formatStable(numeric(row.reward_stable))}</p>
                            </td>
                            <td className="px-4 py-3">
                              <Badge variant={badge.variant}>{badge.label}</Badge>
                              <p className="mt-1 text-xs text-ink-muted">{row.settle_attempts ?? 0} attempts</p>
                            </td>
                            <td className="px-4 py-3 text-ink-muted">{formatDateTime(row.created_at)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </section>

        <div className="flex items-start gap-3 rounded-card border border-border bg-surface-subtle px-4 py-3 text-sm text-ink-muted">
          <Trophy className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p>
            This page is Supabase-backed. Revenue, paid ticket bundles, repeat purchases, and ARPPU need the
            SkillGamesV2 contract events indexed through Dune or an on-chain sync table.
          </p>
        </div>
      </div>
    </div>
  );
}
