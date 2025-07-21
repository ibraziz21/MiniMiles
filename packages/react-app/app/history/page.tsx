'use client';

import React, { useEffect, useState } from 'react';
import HistoryStats from '@/components/history-stats';
import MiniMilesHistoryCard from '@/components/mini-miles-history-card';
import TransactionHistoryCard from '@/components/transaction-history-card';
import { RaffleCard } from '@/components/raffle-card';
import { RaffleResultCard } from '@/components/raffle-result-card';

import { useWeb3 } from '@/contexts/useWeb3';
import { useHistoryBundle } from '@/helpers/useHistoryBundle'; // adjust path if different
import { fetchActiveRaffles, Raffle } from '@/helpers/raffledisplay';
import { fetchTotalCompletedChallenges } from '@/helpers/fetchTotalCompleteChallenges';

import { akibaMilesSymbol } from '@/lib/svg';
import { RaffleImg1, RaffleImg2, RaffleImg5 } from '@/lib/img';
import { StaticImageData } from 'next/image';
import dayjs from 'dayjs';

const TOKEN_IMAGES: Record<string, StaticImageData> = {
  cUSD: RaffleImg1,
  USDT: RaffleImg2,
  Miles: RaffleImg5,
  default: akibaMilesSymbol,
};

export default function HistoryPage() {
  /* -------------------------------------------------- web3 / address */
  const { address, getakibaMilesBalance } = useWeb3();

  /* -------------------------------------------------- aggregated history bundle */
  const {
    data: bundle,
    isLoading: bundleLoading,
    error: bundleError,
  } = useHistoryBundle();

  /* -------------------------------------------------- local state */
  const [raffles, setRaffles] = useState<Raffle[]>([]);
  const [rafflesLoading, setRafflesLoading] = useState(true);

  const [akibaMilesBalance, setAkibaMilesBalance] = useState('0'); // if you display later
  const [totalChallenges, setTotalChallenges] = useState<number>(0);

  /* -------------------------------------------------- load raffles */
  useEffect(() => {
    fetchActiveRaffles()
      .then(setRaffles)
      .catch(console.error)
      .finally(() => setRafflesLoading(false));
  }, []);

  /* -------------------------------------------------- load wallet balance */
  useEffect(() => {
    if (!address) return;
    getakibaMilesBalance()
      .then(setAkibaMilesBalance)
      .catch(() => {});
  }, [address, getakibaMilesBalance]);

  /* -------------------------------------------------- OG: fetch total challenges client-side */
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    (async () => {
      try {
        const count = await fetchTotalCompletedChallenges(address);
        if (!cancelled) setTotalChallenges(count);
      } catch (e) {
        if (!cancelled) setTotalChallenges(0);
      }
    })();
    return () => { cancelled = true; };
  }, [address]);

  /* -------------------------------------------------- derive data with safe guards */
  const stats = bundle?.stats; // may be undefined if API error or still loading
  const historyItems = bundle?.history ?? [];
  const raffleResults = bundle?.raffleResults ?? [];

  const totalEarned = stats?.totalEarned ?? 0;
  const totalWins = stats?.totalRafflesWon ?? 0;
  const totalUSDWonNumber = stats?.totalUSDWon ?? 0;
  const totalUSDWonLabel = `$ ${totalUSDWonNumber.toFixed(2)}`;

  // You are using OG challenges from client fetch, not from bundle:
  const totalChallengesLabel = totalChallenges.toString();

  const participatingRafflesSet = new Set<number>(
    (bundle?.participatingRaffles ?? []).map(Number)
  );

  const overallLoading = bundleLoading || rafflesLoading;

  const formatEndsIn = (ends: number) => {
    const nowSec      = Math.floor(Date.now() / 1000);
    let   secondsLeft = ends - nowSec;
  
    if (secondsLeft <= 0) return 'Ended';
  
    const days = Math.floor(secondsLeft / 86_400); // 24 h
    if (days >= 1) return `${days}d`;
  
    const hours = Math.floor(secondsLeft / 3_600);
    secondsLeft -= hours * 3_600;
    const mins  = Math.floor(secondsLeft / 60);
  
    // “4h 0m” looks odd → show just hours if minutes = 0
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  /* -------------------------------------------------- render */
  return (
    <main className="pb-24 font-sterling bg-onboarding">
      {/* Header */}
      <div className="px-4 min-h-[110px] flex flex-col justify-around">
        <h1 className="text-2xl font-medium">Your history</h1>
        <h3 className="font-extralight">
          View your AkibaMiles gaming stats &amp; history.
        </h3>
      </div>

      {/* Top stats */}
      <MiniMilesHistoryCard points={Number(totalEarned)} />
      <HistoryStats title="Total Raffles won" stats={totalWins.toString()} />
      <HistoryStats
        title="Total prizes won valued in USD"
        stats={totalUSDWonLabel}
      />
      <HistoryStats
        title="Total completed challenges"
        stats={totalChallengesLabel}
      />

{/* ─── Recent raffle results ───────────────────────────── */}
<div className="mx-4 mt-6">
  <div className="flex justify-between items-center">
    <h3 className="text-lg font-extrabold mb-2">Recent raffle results</h3>
  </div>

  {bundleLoading ? (
    <p className="text-sm text-gray-500">Loading…</p>
  ) : raffleResults.length === 0 ? (
    <p className="text-sm text-gray-500">No raffle results yet.</p>
  ) : (
    <div className="flex gap-3 overflow-x-auto">
      {raffleResults.map(r => {
        const img = TOKEN_IMAGES[r.symbol] ?? TOKEN_IMAGES.default;

        return (
          <RaffleResultCard
            key={r.id}
            image={img}
            roundId={r.roundId}
            ts={r.ts}
            winner={`${r.winner.slice(0, 6)}…${r.winner.slice(-4)}`}
            prize={
              r.rewardPool
                ? `${Number(r.rewardPool) / 1e18} ${r.symbol}`
                : r.symbol
            }
            onClick={() =>
              window.open(
                `https://celoscan.io/tx/${r.id}`,
                "_blank",
                "noopener,noreferrer"
              )
            }
          />
        );
      })}
    </div>
  )}
</div>


      {/* Participating Raffles */}
      <div className="mx-4 mt-6">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-extrabold mb-2">Participating Raffles</h3>
        </div>

        {overallLoading && (
          <p className="text-sm text-gray-500">Loading…</p>
        )}

        {!overallLoading && (() => {
          const participated = raffles.filter(r =>
            participatingRafflesSet.has(Number(r.id))
          );

          if (participated.length === 0) {
            return (
              <p className="text-sm text-gray-500">
                You haven’t joined any raffles yet.
              </p>
            );
          }

            return (
              <div className="flex gap-3 overflow-x-auto">
                {participated.map(r => {
                  const img = TOKEN_IMAGES[r.symbol] ?? TOKEN_IMAGES.default;
                  return (
                    <RaffleCard
                      key={r.id}
                      image={r.image ?? img}
                      title={`${r.rewardPool} ${r.symbol} weekly`}
                      endsIn={formatEndsIn(r.ends)}
                      ticketCost={`${r.ticketCost} AkibaMiles for 1 ticket`}
                      locked={false}
                      icon={akibaMilesSymbol}
                    />
                  );
                })}
              </div>
            );
        })()}
      </div>

      {/* Transaction history section header */}
      <div className="px-4 mt-10 min-h-[110px] flex flex-col justify-around">
        <h1 className="text-2xl font-medium">Transaction history</h1>
        <h3 className="font-extralight">
          View all your AkibaMiles activities.
        </h3>
      </div>

      {/* Transaction list */}
      {bundleLoading ? (
        <p className="mx-4 mt-2 text-sm text-gray-500">Loading…</p>
      ) : bundleError ? (
        <p className="mx-4 mt-2 text-sm text-red-600">
          Failed to load history.
        </p>
      ) : (
        <TransactionHistoryCard items={historyItems} />
      )}
    </main>
  );
}
