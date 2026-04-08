"use client";
import dynamic from 'next/dynamic';
import DailyChallenges from '@/components/daily-challenge';
import EnterRaffleSheet from '@/components/enter-raffle-sheet';
import { GameCard } from '@/components/game-card';
import { Hero } from '@/components/Hero';
import MiniPointsCard from '@/components/mini-points-card';
import { RaffleCard } from '@/components/raffle-card';
import { RaffleDetails } from '@/components/raffle-details';
import { SectionHeading } from '@/components/section-heading';
import SpendPartnerQuestSheet from '@/components/spend-partner-quest-sheet';
import SuccessModal from '@/components/success-modal';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useWeb3 } from '@/contexts/useWeb3';
import type { Address } from 'viem'
import type { PhysicalSpendRaffle } from "@/components/physical-raffle-sheet";
import { Dice, RaffleImg1, RaffleImg2, RaffleImg3, airpods, laptop, bicycle, nft1, nft2, RaffleImg5, pods, phone, jbl,bag, sambuds, tv, soundbar, ps5, ebike, usdt, docking,camera,washmachine,chair, claw } from '@/lib/img';
import { Coin, akibaMilesSymbol } from '@/lib/svg';
import { Question, ShoppingBag, Spinner } from '@phosphor-icons/react';
import { StaticImageData } from 'next/image';
import Image from 'next/image';
import Link from 'next/link';
import React, { useEffect, useState } from 'react';
import type { SpendMerchant } from '@/components/voucher-order-sheet';

const VoucherOrderSheet = dynamic(() => import('@/components/voucher-order-sheet'), { ssr: false });
const MerchantVoucherSheet = dynamic(() => import('@/components/merchant-voucher-sheet'), { ssr: false });

// ── Merchant card ─────────────────────────────────────────────────────────────

function MerchantCard({
  merchant,
  onShop,
  onBuyVoucher,
}: {
  merchant: SpendMerchant & { template_count?: number };
  onShop: () => void;
  onBuyVoucher: () => void;
}) {
  return (
    <div className="shrink-0 w-56 border border-gray-100 rounded-2xl bg-white overflow-hidden shadow-sm flex flex-col">
      {/* Fixed-height image */}
      <div className="relative w-full h-32 bg-gray-100">
        {merchant.image_url ? (
          <Image src={merchant.image_url} alt={merchant.name} fill className="object-cover" />
        ) : (
          <div className="flex items-center justify-center h-full">
            <ShoppingBag size={32} className="text-gray-300" />
          </div>
        )}
      </div>

      {/* Content — flex-1 so buttons always sit at the same Y */}
      <div className="p-3 flex flex-col flex-1">
        {/* Fixed 2-line name area */}
        <p className="font-semibold text-sm leading-snug line-clamp-2 mb-1 min-h-[2.5rem]">
          {merchant.name}
        </p>
        {/* Fixed-height sub-label so buttons don't shift */}
        <p className="text-xs text-gray-400 mb-3 h-4 leading-none">
          {(merchant.template_count ?? 0) > 0
            ? `${merchant.template_count} voucher${merchant.template_count === 1 ? '' : 's'} available`
            : '\u00A0'}
        </p>
        {/* Buttons always at the bottom of the card */}
        <div className="flex gap-2 mt-auto">
          <Button
            title="Shop"
            onClick={onShop}
            className="flex-1 bg-[#238D9D] text-white rounded-xl h-9 text-xs font-semibold"
          />
          <Button
            title="Voucher"
            onClick={onBuyVoucher}
            className="flex-1 border-2 border-[#238D9D] bg-transparent text-[#238D9D] rounded-xl h-9 text-xs font-semibold hover:bg-[#238D9D0D]"
          />
        </div>
      </div>
    </div>
  );
}
const PhysicalRaffleSheet = dynamic(() => import('@/components/physical-raffle-sheet'), { ssr: false });

export type TokenRaffle = {
  id: number
  starts: number
  ends: number
  maxTickets: number
  totalTickets: number
  token: { address: Address; symbol: string; decimals: number }
  rewardPool: string        // formatted
  ticketCost: string        // formatted (18d)
  image?: string            // optional if you attach one later
  description?: string
}

export type PhysicalRaffle = {
  id: number
  starts: number
  ends: number
  maxTickets: number
  totalTickets: number
  prizeNFT?: Address
  ticketCost: string        // formatted (18d)
  rewardURI?: string        // if you later expose it
}

async function fetchActiveRaffles(): Promise<{
  tokenRaffles: TokenRaffle[]
  physicalRaffles: PhysicalRaffle[]
}> {
  const res = await fetch('/api/Spend/raffle_display', { cache: 'no-store' })
  if (!res.ok) throw new Error('Failed to fetch raffles')
  return res.json()
}





const TOKEN_IMAGES: Record<string, StaticImageData> = {
  cUSD: RaffleImg1,
  USDT: RaffleImg2,
  Miles: RaffleImg5,
  // default fallback:
  default: RaffleImg3,
}


const PHYSICAL_IMAGES: Record<number, StaticImageData> = {
  108: ps5,
  109: ebike,
  113: phone,
  114: pods,
  116: laptop,
  117: jbl,
  118: bag,
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
  PHYSICAL_IMAGES[raffle.id] ?? sambuds;

const physicalTitle = (raffle: PhysicalRaffle) =>
  PHYSICAL_TITLES[raffle.id] ?? 'Physical prize';

// Shape it to what SpendPartnerQuestSheet expects:
type SpendRaffle = {
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
};



const digitalCashRaffles = [
  { image: RaffleImg1, title: "500 USDT weekly", endsIn: 2, ticketCost: "10 AkibaMiles for 1 ticket" },
  { image: RaffleImg2, title: "250 USDT", endsIn: 5, ticketCost: "6 points for 1 ticket" },
];

const physicalGoodsRaffles = [
  { image: airpods, title: "Airpods 2", endsIn: 6, ticketCost: "3 AkibaMiles for 1 ticket" },
  { image: laptop, title: "Laptop", endsIn: 4, ticketCost: "50 tickets by brand" },
  { image: bicycle, title: "Bicycle", endsIn: 4, ticketCost: "50 tickets by brand" }
];

const nftRaffles = [
  { image: nft1, title: "BoredApe #567", endsIn: 7, ticketCost: "10 AkibaMiles for 1 ticket" },
  { image: nft2, title: "CryptoPunk #789", endsIn: 3, ticketCost: "12 AkibaMiles" },
];

const upcomingGames = [
  { name: "Dice", date: "live", image: Dice, href: "/dice", locked: false },
  { name: "Akiba Claw", date: "live", image: claw, href: "/claw", locked: false },
  { name: "Coin flip", date: "xx/xx/xx", image: Coin, href: "", locked: true },
];

const Page = () => {

  const { address, getUserAddress, getakibaMilesBalance } = useWeb3();
  const [akibaMilesBalance, setakibaMilesBalance] = useState('0');
  const [showPopup, setShowPopup] = useState(false);
  const [selectedRaffle, setSelectedRaffle] = useState<any>(null);
  const [raffleSheetOpen, setRaffleSheetOpen] = useState(false);
  const [loading, setLoading] = useState(true)
  const [tokenRaffles, setTokenRaffles] = useState<TokenRaffle[]>([])
  const [physicalRaffles, setPhysicalRaffles] = useState<PhysicalRaffle[]>([])
  const [activeSheet, setActiveSheet] = useState<null | "token" | "physical">(null);
  const [physicalRaffle, setPhysicalRaffle] = useState<PhysicalSpendRaffle | null>(null);
  const [spendRaffle, setSpendRaffle] = useState<SpendRaffle | null>(null);
  const [hasMounted, setHasMounted] = useState(false);
  const [openSuccess, setOpenSuccess] = useState(false);

  // ── Merchant state ──────────────────────────────────────────────────────
  const [merchants, setMerchants] = useState<(SpendMerchant & { template_count?: number })[]>([]);
  const [loadingMerchants, setLoadingMerchants] = useState(true);
  const [orderMerchant, setOrderMerchant] = useState<SpendMerchant | null>(null);
  const [orderSheetOpen, setOrderSheetOpen] = useState(false);
  const [voucherMerchant, setVoucherMerchant] = useState<SpendMerchant | null>(null);
  const [voucherSheetOpen, setVoucherSheetOpen] = useState(false);


  useEffect(() => {
    setHasMounted(true);
  }, []);

  useEffect(() => {
    getUserAddress();
  }, []);

  useEffect(() => {
    const fetchBalance = async () => {
      if (!address) return;
      try {
        const balance = await getakibaMilesBalance();
        setakibaMilesBalance(balance);
      } catch (error) {
        console.log(error);
      }
    };
    fetchBalance();
  }, [address, getakibaMilesBalance]);

  useEffect(() => {
    fetchActiveRaffles()
      .then(({ tokenRaffles, physicalRaffles }) => {
        setTokenRaffles(tokenRaffles)
        setPhysicalRaffles(physicalRaffles)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  // Fetch merchants
  useEffect(() => {
    fetch('/api/Spend/merchants')
      .then((r) => r.json())
      .then((d) => setMerchants(d.merchants ?? []))
      .catch(() => setMerchants([]))
      .finally(() => setLoadingMerchants(false));
  }, []);

  const formatEndsIn = (ends: number) => {
    const nowSec = Math.floor(Date.now() / 1000);
    let secondsLeft = ends - nowSec;

    if (secondsLeft <= 0) return 'Ended';

    const days = Math.floor(secondsLeft / 86_400); // 24 h
    if (days >= 1) return `${days}d`;

    const hours = Math.floor(secondsLeft / 3_600);
    secondsLeft -= hours * 3_600;
    const mins = Math.floor(secondsLeft / 60);

    // “4h 0m” looks odd → show just hours if minutes = 0
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  return (
    <main className="pb-24 font-sterling bg-onboarding">
      <div className="px-4 flex flex-col justify-around gap-1 mb-4">
        <h1 className="text-2xl font-medium">Spend</h1>
        <h3 className='font-poppins'>Win big by entering our Raffles</h3>
      </div>
      <MiniPointsCard points={Number(akibaMilesBalance)} />

      <div className="mx-3">
        <EnterRaffleSheet />
      </div>

      {/* ── Merchants ────────────────────────────────────────────── */}
      <div className="mx-4 mt-6">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-lg font-extrabold">Shop & Save</h3>
          <Link href="/vouchers" className="text-sm text-[#238D9D] font-medium">
            My Vouchers →
          </Link>
        </div>

        {loadingMerchants ? (
          <div className="flex justify-center py-6">
            <Spinner size={24} className="animate-spin text-[#238D9D]" />
          </div>
        ) : merchants.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">
            No merchants available yet.
          </p>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-1">
            {merchants.map((m) => (
              <MerchantCard
                key={m.id}
                merchant={m}
                onShop={() => {
                  setOrderMerchant(m);
                  setOrderSheetOpen(true);
                }}
                onBuyVoucher={() => {
                  setVoucherMerchant(m);
                  setVoucherSheetOpen(true);
                }}
              />
            ))}
          </div>
        )}
      </div>
      <div className="mx-4 mt-6">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-extrabold mb-2">Digital Cash Rewards</h3>
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
      locked={false}
      icon={akibaMilesSymbol}
      onClick={() => {
        setPhysicalRaffle(null);
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
        });
        setActiveSheet("token");     // <-- only this one opens
      }}
    />
  )
})}
        </div>
      </div>

       {/* PHYSICAL */}
       <div className="mx-4 mt-6">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-extrabold mb-2">Physical Goods Rewards</h3>
        </div>
        <div className="flex gap-3 overflow-x-auto">
        {physicalRaffles.map((r) => {
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
      onClick={() => {
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
      }}
    />
  );
})}


          {physicalRaffles.length === 0 && (
            <div className="text-sm opacity-70 px-2 py-4">No physical rewards live right now.</div>
          )}
        </div>
      </div>

      <div>
        <SectionHeading title="Games" />
        <div className="flex space-x-3 overflow-x-auto px-4">
  {upcomingGames.map((game, idx) => {
    const card = (
      <GameCard
        name={game.name}
        date={game.date}
        image={game.image}
        locked={game.locked}
      />
    );

    if (!game.locked && game.href) {
      return (
        <Link
          key={idx}
          href={game.href}
          className="shrink-0"
        >
          {card}
        </Link>
      );
    }

    // Locked previews (non-clickable)
    return (
      <div key={idx} className="shrink-0">
        {card}
      </div>
    );
  })}
</div>
</div>

<PhysicalRaffleSheet
  open={activeSheet === "physical"}
  onOpenChange={(open: boolean) => setActiveSheet(open ? "physical" : null)}
  raffle={physicalRaffle}
/>

{hasMounted && (
  <SpendPartnerQuestSheet
    open={activeSheet === "token"}
    onOpenChange={(open: boolean) => setActiveSheet(open ? "token" : null)}
    raffle={spendRaffle}
  />
)}

<VoucherOrderSheet
  open={orderSheetOpen}
  onOpenChange={setOrderSheetOpen}
  merchant={orderMerchant}
/>

<MerchantVoucherSheet
  open={voucherSheetOpen}
  onOpenChange={setVoucherSheetOpen}
  merchant={voucherMerchant}
/>

    </main>
  );
}

export default Page;
