// app/api/history/[address]/route.ts
import { NextResponse } from 'next/server';
import { createPublicClient, http, type Address, type Abi } from 'viem';
import { celo } from 'viem/chains';
import erc20Abi from '@/contexts/cusd-abi.json';
import { createClient } from '@supabase/supabase-js';

const publicClient = createPublicClient({ chain: celo, transport: http() });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SUBGRAPH_URL =
  'https://api.studio.thegraph.com/query/115307/akiba-v-3/version/latest';

const RAFFLE_QUERY = /* GraphQL */ `
query Raffle($user: Bytes!) {
  joins: participantJoineds(
    where: { participant: $user }
    orderBy: blockTimestamp
    orderDirection: desc
  ) { id roundId tickets blockTimestamp transactionHash }

  raffleResults: winnerSelecteds(
    orderBy: blockTimestamp
    orderDirection: desc
    first: 50
  ) { id roundId reward blockTimestamp winner }

  rounds: roundCreateds(
    orderBy: blockTimestamp
    orderDirection: desc
    first: 50
  ) { roundId rewardToken rewardPool }
}
`;

interface CacheEntry { expires: number; data: any }
const CACHE: Record<string, CacheEntry> = {};
const TTL_MS     = 5 * 60_000;
const CDN_MAXAGE = 60;
const CDN_STALE  = 5 * 60;

const USD_SYMBOLS = new Set(['cusd', 'usdt', 'usdc', 'dai']);

function milestoneNote(reason: string): string {
  if (reason === 'profile-milestone-50')  return 'Profile 50% complete milestone';
  if (reason === 'profile-milestone-100') return 'Profile 100% complete milestone';
  if (reason.startsWith('streak:'))       return `Streak reward — ${reason.slice(7)}`;
  return 'Bonus reward';
}

function isAddress(a: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(a);
}

/** Convert "YYYY-MM-DD" or ISO string → unix seconds */
function toTs(dateStr: string): number {
  return Math.floor(new Date(dateStr).getTime() / 1000);
}

export async function GET(_req: Request, context: any) {
  const params  = await context?.params;
  const address: string | undefined = params?.address;

  if (!address || !isAddress(address)) {
    return NextResponse.json({ ok: false, error: 'Bad address' }, { status: 400 });
  }

  const key = address.toLowerCase();

  // In-process cache hit
  if (CACHE[key] && CACHE[key].expires > Date.now()) {
    return NextResponse.json(
      { ok: true, ...CACHE[key].data, meta: { ...CACHE[key].data.meta, cached: true } },
      { headers: { 'X-Cache': 'HIT', 'Cache-Control': `public, s-maxage=${CDN_MAXAGE}, stale-while-revalidate=${CDN_STALE}` } }
    );
  }

  const stale = () => CACHE[key] ?? null;

  // ── All fetches in parallel ──────────────────────────────────────────────────
  const [dailyRes, partnerRes, mintRes, subgraphRes] = await Promise.allSettled([

    // 1. Daily quest completions — full lifetime history
    supabase
      .from('daily_engagements')
      .select('id, quest_id, claimed_at, points_awarded, quests(title)')
      .eq('user_address', key)
      .order('claimed_at', { ascending: false })
      .limit(500),

    // 2. Partner quest completions — full lifetime history
    supabase
      .from('partner_engagements')
      .select('id, partner_quest_id, claimed_at, points_awarded, partner_quests(title)')
      .eq('user_address', key)
      .order('claimed_at', { ascending: false })
      .limit(200),

    // 3. Mint jobs — only profile milestones and streaks (not covered by engagement tables)
    supabase
      .from('minipoint_mint_jobs')
      .select('id, points, reason, tx_hash, created_at')
      .eq('user_address', key)
      .eq('status', 'completed')
      .or('reason.like.profile-milestone-%,reason.like.streak:%')
      .order('created_at', { ascending: false })
      .limit(200),

    // 4. Subgraph — raffle joins / results / round metadata
    fetch(SUBGRAPH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: RAFFLE_QUERY, variables: { user: key } }),
    }),
  ]);

  // ── Build earn items ─────────────────────────────────────────────────────────
  let earnItems: any[] = [];
  let dbOk = false;

  // Daily engagements
  if (dailyRes.status === 'fulfilled' && !dailyRes.value.error) {
    dbOk = true;
    for (const row of dailyRes.value.data ?? []) {
      const questTitle = (row as any).quests?.title ?? null;
      earnItems.push({
        id:     `daily-${row.id}`,
        ts:     toTs(row.claimed_at),
        type:   'EARN' as const,
        amount: String(row.points_awarded ?? 0),
        note:   questTitle ? `Daily quest — ${questTitle}` : 'Daily quest reward',
      });
    }
  }

  // Partner engagements
  if (partnerRes.status === 'fulfilled' && !partnerRes.value.error) {
    dbOk = true;
    for (const row of partnerRes.value.data ?? []) {
      const questTitle = (row as any).partner_quests?.title ?? null;
      earnItems.push({
        id:     `partner-${row.id}`,
        ts:     toTs(row.claimed_at),
        type:   'EARN' as const,
        amount: String(row.points_awarded ?? 0),
        note:   questTitle ? `Partner quest — ${questTitle}` : 'Partner quest reward',
      });
    }
  }

  // Mint jobs (profile milestones + streaks)
  if (mintRes.status === 'fulfilled' && !mintRes.value.error) {
    dbOk = true;
    for (const row of mintRes.value.data ?? []) {
      earnItems.push({
        id:     `mint-${row.id}`,
        ts:     toTs(row.created_at),
        type:   'EARN' as const,
        amount: String(row.points ?? 0),
        txHash: row.tx_hash ?? undefined,
        note:   milestoneNote(row.reason ?? ''),
      });
    }
  }

  // Stale fallback if all DB queries failed
  if (!dbOk) {
    const s = stale();
    if (s) earnItems = s.data._earnItems ?? [];
  }

  // Sort by newest first
  earnItems.sort((a, b) => b.ts - a.ts);

  // ── Subgraph → raffle items ─────────────────────────────────────────────────
  let joinItems:    any[] = [];
  let resultItems:  any[] = [];
  let subgraphStale = false;

  if (subgraphRes.status === 'fulfilled') {
    try {
      const res = subgraphRes.value;
      if (res.status === 429) throw new Error('rate-limited');

      const graphJson = await res.json();
      if (res.ok && !graphJson.errors) {
        const d             = graphJson.data || {};
        const joins         = Array.isArray(d.joins)         ? d.joins         : [];
        const raffleResults = Array.isArray(d.raffleResults)  ? d.raffleResults  : [];
        const rounds: any[] = Array.isArray(d.rounds)         ? d.rounds         : [];

        // Token symbol resolution via multicall
        const symbolCache: Record<string, string> = {};
        const tokenAddrs: Address[] = rounds
          .map((r: any) => r.rewardToken as Address)
          .filter(Boolean);

        if (tokenAddrs.length) {
          const unique = [...new Set(tokenAddrs.map(a => a.toLowerCase() as Address))];
          const calls  = unique.map(addr => ({ address: addr, abi: erc20Abi.abi as Abi, functionName: 'symbol' }));
          try {
            const results = await publicClient.multicall({ contracts: calls, allowFailure: true });
            unique.forEach((addr, i) => {
              symbolCache[addr] = results[i].status === 'success' ? (results[i].result as string) : '???';
            });
          } catch { /* symbols optional */ }
        }

        const roundById: Record<string, any> = {};
        for (const r of rounds) roundById[r.roundId] = r;

        joinItems = joins.map((j: any) => ({
          id:      j.id,
          ts:      +j.blockTimestamp,
          type:    'RAFFLE_ENTRY' as const,
          roundId: String(j.roundId),
          tickets: Number(j.tickets ?? 1),
          txHash:  j.transactionHash ?? undefined,
          note:    `Entered raffle #${j.roundId}` + (Number(j.tickets) > 1 ? ` · ${j.tickets} tickets` : ''),
        }));

        resultItems = raffleResults.map((w: any) => {
          const meta      = roundById[w.roundId] || {};
          const tokenAddr = (meta.rewardToken || '0x').toLowerCase();
          const symbol    = symbolCache[tokenAddr] || '???';
          return {
            id:           w.id,
            ts:           +w.blockTimestamp,
            type:         'RAFFLE_RESULT' as const,
            roundId:      String(w.roundId),
            winner:       w.winner,
            rewardToken:  tokenAddr,
            symbol,
            rewardAmount: w.reward ?? null,
            rewardPool:   meta.rewardPool ?? null,
            image:        null,
            note:
              symbol !== '???' && w.reward
                ? `Won ${Number(w.reward) / 1e18} ${symbol}`
                : `Raffle #${w.roundId} result`,
          };
        });
      } else {
        throw new Error('subgraph-error');
      }
    } catch (e: any) {
      console.warn('[history] Subgraph error:', e?.message);
      const s = stale();
      if (s) {
        joinItems     = s.data._joinItems    ?? [];
        resultItems   = s.data.raffleResults ?? [];
        subgraphStale = true;
      }
    }
  }

  // ── Stats ───────────────────────────────────────────────────────────────────
  const myWins          = resultItems.filter((r: any) => r.winner?.toLowerCase() === key);
  const totalRafflesWon = myWins.length;
  const totalEarned     = earnItems.reduce((s: number, i: any) => s + Number(i.amount), 0);
  const totalUSDWon     = myWins.reduce((s: number, w: any) => {
    const amount = w.rewardAmount ?? w.rewardPool;
    if (amount && USD_SYMBOLS.has((w.symbol ?? '').toLowerCase())) {
      return s + Number(amount) / 1e18;
    }
    return s;
  }, 0);

  const history = [...earnItems, ...joinItems].sort((a, b) => b.ts - a.ts);
  const participatingRaffles = [...new Set(joinItems.map((j: any) => Number(j.roundId)))];

  const payload = {
    history,
    raffleResults: resultItems,
    stats: { totalEarned, totalRafflesWon, totalUSDWon },
    participatingRaffles,
    _earnItems: earnItems,
    _joinItems: joinItems,
    meta: {
      address: key,
      generatedAt: new Date().toISOString(),
      counts: {
        daily:   (dailyRes.status === 'fulfilled' ? dailyRes.value.data?.length : 0) ?? 0,
        partner: (partnerRes.status === 'fulfilled' ? partnerRes.value.data?.length : 0) ?? 0,
        milestones: (mintRes.status === 'fulfilled' ? mintRes.value.data?.length : 0) ?? 0,
        joins:   joinItems.length,
        results: resultItems.length,
        myWins:  myWins.length,
      },
      cached: false,
      stale:  !dbOk || subgraphStale,
      ttlMs:  TTL_MS,
    },
  };

  CACHE[key] = { expires: Date.now() + TTL_MS, data: payload };

  return NextResponse.json({ ok: true, ...payload }, {
    headers: {
      'X-Cache': 'MISS',
      'Cache-Control': `public, s-maxage=${CDN_MAXAGE}, stale-while-revalidate=${CDN_STALE}`,
    },
  });
}
