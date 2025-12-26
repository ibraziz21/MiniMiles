// src/app/page.tsx (Home)
"use client";

import ReferFab from "@/components/refer-fab";
import DailyChallenges from "@/components/daily-challenge";
import DashboardHeader from "@/components/dashboard-header";
import { RaffleCard } from "@/components/raffle-card";
import PointsCard from "@/components/points-card";
import { SectionHeading } from "@/components/section-heading";
import { useWeb3 } from "@/contexts/useWeb3";
import {
  RaffleImg1,
  RaffleImg2,
  RaffleImg3,
  RaffleImg5,
  ps5,
  tv,
  soundbar,
  ebike,
  usdt,
  phone,
  pods,
  laptop,
  jbl,
  bag,
  tab,
  hphone,
  watch,
  nintendo,
  ring,
  microwave,
  fridge,
  projector,
  docking, camera, washmachine, chair
} from "@/lib/img";
import { akibaMilesSymbol } from "@/lib/svg";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchActiveRaffles,
  PhysicalRaffle,
  type TokenRaffle,
} from "@/helpers/raffledisplay";
import Link from "next/link";
import type { StaticImageData } from "next/image";
import dynamic from "next/dynamic";
import truncateEthAddress from "truncate-eth-address";
import type { PhysicalSpendRaffle } from "@/components/physical-raffle-sheet";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_SERVICE_KEY || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const PhysicalRaffleSheet = dynamic(
  () => import("@/components/physical-raffle-sheet"),
  { ssr: false }
);
const SpendPartnerQuestSheet = dynamic(
  () => import("@/components/spend-partner-quest-sheet"),
  { ssr: false }
);
const WinningModal = dynamic(() => import("@/components/winning-modal"), {
  ssr: false,
});

/** ───────────────── Token raffle image map ───────────────── */
const TOKEN_IMAGES: Record<string, StaticImageData> = {
  cUSD: RaffleImg1,
  USDT: RaffleImg2,
  Miles: RaffleImg5,
  default: usdt,
};

const PHYSICAL_IMAGES: Record<number, StaticImageData> = {
  108: ps5,
  109: ebike,
  113: phone,
  114: pods,
  116: laptop,
  117: jbl,
  118: bag,
  120: hphone,
  121: tab,
  123: ring,
  124: watch,
  126: nintendo,
  127: microwave,
  128: fridge,
  130: tv,
  131: projector,
  133: phone,
  134: bag,
  136: laptop,
  137: docking,
  139: pods,
  140: jbl,
   142: camera,
  143: washmachine,
  144: chair,
};

const PHYSICAL_TITLES: Record<number, string> = {
  108: "Playstation 5",
  109: "Electric Bike",
  113: "Samsung A24 (Smartphone) ",
  114: "Earpods (Oraimo) ",
  116: "Laptop",
  117: "JBL Speaker",
  118: "Laptop Bag",
  120: "Marshall Headphones",
  121: "Samsung Galaxy Tab",
  123: "Ring Video Camera",
  124: "Samsung Galaxy Watch 4",
  126: "Nintendo Switch",
  127: "Microwave Oven",
  128: "Refrigerator",
  130: "43 inch TV",
  131: "Projector",
  133: "Samsung A24 (Smartphone)",
  134: "Laptop Bag",
  136: "Laptop",
  137: "Docking Station ",
  139: "Oraimo Earpods",
  140: "JBL Speaker",
  142: "Canon EOS 1200D Camera",
  143: "Washing Machine",
  144: "Gaming Chair",
};


const pickPhysicalImage = (raffle: PhysicalRaffle) =>
  PHYSICAL_IMAGES[raffle.id] ?? soundbar;

const physicalTitle = (raffle: PhysicalRaffle) =>
  PHYSICAL_TITLES[raffle.id] ?? "Physical prize";

/** ─────────────── Extend TokenRaffle with winners ────────── */
export type TokenRaffleWithWinners = TokenRaffle & { winners: number };

/** ───────────────── Spend sheet payload ──────────────────── */
export type SpendRaffle = {
  id: number;
  title: string;
  reward: string;
  prize: string;
  endDate: string;
  ticketCost: string;
  image: StaticImageData;
  balance: number;
  symbol: string;
  totalTickets: number;
  maxTickets: number;
  winners?: number;
};

export default function Home() {
  const router = useRouter();
  const { address, getUserAddress, getakibaMilesBalance } = useWeb3();

  const [akibaMilesBalance, setakibaMilesBalance] = useState("0");
  const [winnerOpen, setWinnerOpen] = useState(false);

  const [tokenRaffles, setTokenRaffles] = useState<TokenRaffleWithWinners[]>(
    []
  );
  const [physicalRaffles, setPhysicalRaffles] = useState<PhysicalRaffle[]>([]);
  const [loading, setLoading] = useState(true);

  const [spendRaffle, setSpendRaffle] = useState<SpendRaffle | null>(null);
  const [physicalRaffle, setPhysicalRaffle] =
    useState<PhysicalSpendRaffle | null>(null);
  const [activeSheet, setActiveSheet] = useState<null | "token" | "physical">(
    null
  );
  const [hasMounted, setHasMounted] = useState(false);

  const [displayName, setDisplayName] = useState<string>("");
  //Auto-Refresh
  const BALANCE_REFRESH_EVENT = "akiba:miles:refresh";

const refreshMilesBalance = useCallback(async () => {
  if (!address) return;
  try {
    const balance = await getakibaMilesBalance();
    setakibaMilesBalance(balance);
  } catch {
    // swallow
  }
}, [address, getakibaMilesBalance]);

// Helps when tx receipt is mined but RPC/cache/indexing lags a bit
const refreshMilesBalanceSoon = useCallback(() => {
  void refreshMilesBalance();
  window.setTimeout(() => void refreshMilesBalance(), 1500);
  window.setTimeout(() => void refreshMilesBalance(), 4500);
}, [refreshMilesBalance]);


  useEffect(() => setHasMounted(true), []);

  useEffect(() => {
    getUserAddress();
  }, [getUserAddress]);

  useEffect(() => {
    void refreshMilesBalance();
  }, [refreshMilesBalance]);

  useEffect(() => {
    const handler = () => refreshMilesBalanceSoon();
    window.addEventListener(BALANCE_REFRESH_EVENT, handler);
    return () => window.removeEventListener(BALANCE_REFRESH_EVENT, handler);
  }, [refreshMilesBalanceSoon]);
  

  /** ───────── fetch username (if set) ───────── */
  useEffect(() => {
    if (!address) {
      setDisplayName("");
      return;
    }
    const loadUsername = async () => {
      try {
        const { data, error } = await supabase
          .from("users")
          .select("username")
          .eq("user_address", address.toLowerCase())
          .maybeSingle();

        if (error) {
          console.error("[Home] fetch username error:", error);
          setDisplayName(truncateEthAddress(address));
          return;
        }

        if (data?.username) {
          setDisplayName(data.username as string);
        } else {
          setDisplayName(truncateEthAddress(address));
        }
      } catch (e) {
        console.error("[Home] username fetch exception:", e);
        setDisplayName(truncateEthAddress(address));
      }
    };

    void loadUsername();
  }, [address]);

  useEffect(() => {
    fetchActiveRaffles()
      .then(({ tokenRaffles, physicalRaffles }) => {
        const withWinners: TokenRaffleWithWinners[] = tokenRaffles.map((r) => ({
          ...r,
          winners: r.id === 112 ? 5 : 1,
        }));

        setTokenRaffles(withWinners);
        setPhysicalRaffles(physicalRaffles);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div>Loading…</div>;

  const formatEndsIn = (ends: number) => {
    const nowSec = Math.floor(Date.now() / 1000);
    let secondsLeft = ends - nowSec;

    if (secondsLeft <= 0) return "Ended";

    const days = Math.floor(secondsLeft / 86_400);
    if (days >= 1) return `${days}d`;

    const hours = Math.floor(secondsLeft / 3_600);
    secondsLeft -= hours * 3_600;
    const mins = Math.floor(secondsLeft / 60);

    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  const headerName = displayName || (address ? truncateEthAddress(address) : "");

  
  // ─────────────────────────────────────────────
  // Physical raffle grouping
  // ─────────────────────────────────────────────
  const TOP_PRIZE_IDS = new Set<number>([108, 109]); // PS5 + E-bike
  const ADVENT_DAILY_IDS = new Set<number>([113,114,116, 117, 118, 120,121,123,124,125, 126,127,128, 130, 131, 133, 134, 136, 137, 139, 140, 142,143,144]); // TV + Soundbar

  const topPrizes = physicalRaffles.filter((r) => TOP_PRIZE_IDS.has(r.id));
  const adventDaily = physicalRaffles.filter((r) => ADVENT_DAILY_IDS.has(r.id));

  const openPhysical = (r: PhysicalRaffle) => {
    const cardImg = pickPhysicalImage(r);
    const title = physicalTitle(r);

    setSpendRaffle(null);
    setPhysicalRaffle({
      id: r.id,
      title,
      endDate: formatEndsIn(r.ends),
      ticketCost: r.ticketCost,
      image: cardImg,
      balance: Number(akibaMilesBalance),
      totalTickets: r.totalTickets,
      maxTickets: r.maxTickets,
    });
    setActiveSheet("physical");
  };

  return (
    <main className="pb-24 font-sterling">
      {/* 🏆 Winner modal only mounts when user opens from the header icon */}
      {winnerOpen && (
        <WinningModal open={winnerOpen} onOpenChange={setWinnerOpen} />
      )}

      <DashboardHeader
        name={headerName}
        onOpenWinners={() => setWinnerOpen(true)}
      />

      <PointsCard points={Number(akibaMilesBalance)} />

      {/* Daily challenges */}
      <div className="mx-4 mt-6 gap-1">
        <div className="flex justify-between items-center my-2">
          <h3 className="text-lg font-medium">Daily challenges</h3>
          <Link href="/earn">
            <span className="text-sm text-[#238D9D] hover:underline font-medium">
              See All ›
            </span>
          </Link>
        </div>
        <p className="text-gray-500">
          Completed a challenge? Click & claim Miles
        </p>
        <div className="flex gap-3 overflow-x-auto">
          <DailyChallenges />
        </div>
      </div>

      {/* PHYSICAL — Top Prizes */}
      <div className="mx-4 mt-6">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-extrabold mb-2">Top Prizes</h3>
        </div>

        <div className="flex gap-3 overflow-x-auto">
          {topPrizes.map((r) => {
            const cardImg = pickPhysicalImage(r);
            const title = physicalTitle(r);

            return (
              <RaffleCard
                key={r.id}
                image={cardImg}
                title={title}
                endsIn={formatEndsIn(r.ends)}
                ticketCost={`${r.ticketCost} AkibaMiles for 1 ticket`}
                icon={akibaMilesSymbol}
                locked={false}
                onClick={() => openPhysical(r)}
              />
            );
          })}

          {topPrizes.length === 0 && (
            <div className="text-sm opacity-70 px-2 py-4">
              No top prizes live right now.
            </div>
          )}
        </div>
      </div>

      {/* PHYSICAL — Advent Daily Prizes */}
      <div className="mx-4 mt-6">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-extrabold mb-2">Advent Daily Prizes</h3>
        </div>

        <div className="flex gap-3 overflow-x-auto">
          {adventDaily.map((r) => {
            const cardImg = pickPhysicalImage(r);
            const title = physicalTitle(r);

            return (
              <RaffleCard
                key={r.id}
                image={cardImg}
                title={title}
                endsIn={formatEndsIn(r.ends)}
                ticketCost={`${r.ticketCost} AkibaMiles for 1 ticket`}
                icon={akibaMilesSymbol}
                locked={false}
                onClick={() => openPhysical(r)}
              />
            );
          })}

          {adventDaily.length === 0 && (
            <div className="text-sm opacity-70 px-2 py-4">
              No advent daily prizes live right now.
            </div>
          )}
        </div>
      </div>

      {/* TOKEN / Join Rewards */}
      <div className="mx-4 mt-6">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-medium">Digital Cash Prizes</h3>
          <Link href="/spend">
            <span className="text-sm text-[#238D9D] hover:underline">
              View more ›
            </span>
          </Link>
        </div>

        <div className="flex gap-3 overflow-x-auto">
          {tokenRaffles.map((r) => {
            const cardImg =
              (r as any).image ??
              TOKEN_IMAGES[r.token.symbol] ??
              TOKEN_IMAGES.default;

            return (
              <RaffleCard
                key={r.id}
                image={cardImg}
                title={`${r.rewardPool} ${r.token.symbol}`}
                endsIn={formatEndsIn(r.ends)}
                ticketCost={`${r.ticketCost} AkibaMiles for 1 ticket`}
                icon={akibaMilesSymbol}
                winners={r.winners}
                locked={false}
                onClick={() => {
                  setSpendRaffle({
                    id: r.id,
                    title: r.description ?? `${r.rewardPool} ${r.token.symbol}`,
                    reward: `${r.rewardPool} ${r.token.symbol}`,
                    prize: `${r.rewardPool} ${r.token.symbol}`,
                    endDate: formatEndsIn(r.ends),
                    ticketCost: `${r.ticketCost} AkibaMiles`,
                    image: cardImg,
                    balance: Number(akibaMilesBalance),
                    symbol: r.token.symbol,
                    maxTickets: r.maxTickets,
                    totalTickets: r.totalTickets,
                    winners: r.winners,
                  });
                  setActiveSheet("token");
                }}
              />
            );
          })}

          {tokenRaffles.length === 0 && (
            <div className="text-sm opacity-70 px-2 py-4">
              No Rewards live right now.
            </div>
          )}
        </div>
      </div>

      {/* Sheets */}
      <PhysicalRaffleSheet
        open={activeSheet === "physical"}
        onOpenChange={(o) => setActiveSheet(o ? "physical" : null)}
        raffle={physicalRaffle}
      />

      {hasMounted && (
        <SpendPartnerQuestSheet
          open={activeSheet === "token"}
          onOpenChange={(o) => setActiveSheet(o ? "token" : null)}
          raffle={spendRaffle}
        />
      )}

      <ReferFab />
    </main>
  );
}
