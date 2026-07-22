'use client';

// Replaces components/partner-quests.tsx on the Earn page (spend-earn-redesign
// spec §2b). Same quest engine (partner_quests / partner_engagements /
// eligibility+claim API + QuestClaimSheet-family UI), new catalog: merchant
// discovery instead of partner-app follows. partner-quests.tsx stays mounted
// nowhere but is kept in the tree — see open question #2 in the spec.

import Image from 'next/image';
import { createClient } from '@supabase/supabase-js';
import { useQuery } from '@tanstack/react-query';
import { useWeb3 } from '@/contexts/useWeb3';
import cn from 'clsx';
import { akibaMilesSymbol } from '@/lib/svg';
import checkIcon from '@/public/svg/check-icon.svg';
import lockIcon from '@/public/svg/lock-icon.svg';
import { isoWeek } from '@/lib/games/week';
import {
  QUEST_AKIBA_PASS,
  QUEST_BROWSE_DEALS,
  QUEST_SPONSORED_LEADERBOARD,
  QUEST_COMPLETE_PROFILE,
  QUEST_REDEEM_VOUCHER,
} from '@/lib/merchantDiscoveryQuests';
import type { Quest } from './partner-quests';

/* ─── Launch quest catalog ───────────────────────────────── */
/* IDs are seeded in sql/merchant_discovery_quests.sql — keep in sync.       */

export const MERCHANT_DISCOVERY_QUESTS: Quest[] = [
  {
    id: QUEST_AKIBA_PASS,
    isLocked: false,
    title: 'Get your Akiba Pass',
    description: 'Your personal QR code — earn Miles in real shops.',
    reward: '20 akibaMiles',
    color: '#238D9D1A',
    actionLink: '/akiba-pass?src=earn_quest',
    instructions: [
      { title: 'Open the Pass flow', text: 'See how the Akiba Pass works at partner shops.' },
      { title: 'Come back here', text: 'Claim your Miles for checking it out.' },
    ],
  },
  {
    id: QUEST_BROWSE_DEALS,
    isLocked: false,
    title: "Browse this week's merchant deals",
    description: 'See what you can spend your Miles on right now.',
    reward: '5 akibaMiles',
    color: '#238D9D1A',
    actionLink: '/spend',
    instructions: [
      { title: 'Open Spend', text: 'Check out the merchant deals shelf.' },
      { title: 'Come back here', text: 'Claim your Miles.' },
    ],
  },
  {
    id: QUEST_SPONSORED_LEADERBOARD,
    isLocked: false,
    title: 'Play the sponsored leaderboard',
    description: "Play this week's featured game — resets every week.",
    reward: '25 akibaMiles / week',
    color: '#238D9D1A',
    actionLink: '/games/challenge',
    instructions: [
      { title: 'Play a featured game', text: 'Finish a scored session in this week’s sponsored game.' },
      { title: 'Come back here', text: 'Claim once your session is recorded — once per week.' },
    ],
  },
  {
    id: QUEST_COMPLETE_PROFILE,
    isLocked: false,
    title: 'Complete your profile',
    description: 'Set your country so we can route local deals and prizes to you.',
    reward: '50 akibaMiles',
    color: '#238D9D1A',
    actionLink: '/profile',
    instructions: [
      { title: 'Open your profile', text: 'Set your country.' },
      { title: 'Come back here', text: 'Claim your Miles.' },
    ],
  },
  {
    id: QUEST_REDEEM_VOUCHER,
    isLocked: false,
    title: 'Redeem your first voucher',
    description: 'Use a voucher at checkout to complete this quest.',
    reward: '100 akibaMiles',
    color: '#238D9D1A',
    actionLink: '/vouchers',
    instructions: [
      { title: 'Redeem a voucher', text: 'Order goods with a voucher until it’s marked redeemed.' },
      { title: 'Come back here', text: 'Claim your Miles.' },
    ],
  },
];

/* ─── Supabase hook ──────────────────────────────────────── */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

function useMerchantQuestClaimStatus(address?: string) {
  return useQuery<Set<string>>({
    enabled: !!address,
    queryKey: ['merchant-discovery-claimed', address],
    refetchOnMount: 'always',
    queryFn: async () => {
      if (!address) return new Set<string>();
      const addrLc = address.toLowerCase();
      const week = isoWeek();

      const [{ data: engagements }, { data: weeklyClaim }] = await Promise.all([
        supabase
          .from('partner_engagements')
          .select('partner_quest_id')
          .eq('user_address', addrLc)
          .in('partner_quest_id', [
            QUEST_AKIBA_PASS,
            QUEST_BROWSE_DEALS,
            QUEST_COMPLETE_PROFILE,
            QUEST_REDEEM_VOUCHER,
          ]),
        supabase
          .from('partner_quest_weekly_claims')
          .select('iso_week')
          .eq('user_address', addrLc)
          .eq('partner_quest_id', QUEST_SPONSORED_LEADERBOARD)
          .eq('iso_week', week)
          .maybeSingle(),
      ]);

      const claimed = new Set((engagements ?? []).map((d) => d.partner_quest_id));
      if (weeklyClaim) claimed.add(QUEST_SPONSORED_LEADERBOARD);
      return claimed;
    },
  });
}

/* ─── Quest row ───────────────────────────────────────────── */

function QuestRow({ quest, claimed, onClick }: { quest: Quest; claimed: boolean; onClick: () => void }) {
  return (
    <div
      onClick={!claimed ? onClick : undefined}
      className={cn(
        'flex min-h-[80px] w-full items-stretch rounded-[16px] border overflow-hidden bg-white',
        claimed ? 'border-[#A7F3D0]' : 'border-[#E5E7EB]',
        !claimed && 'cursor-pointer active:opacity-80',
      )}
    >
      <div
        className={cn(
          'flex self-stretch w-[48px] shrink-0 items-center justify-center',
          claimed ? 'bg-[#CFF2E5]' : 'bg-[#8080801A]',
        )}
      >
        <Image
          src={claimed ? checkIcon : lockIcon}
          alt=""
          width={18}
          height={18}
          className="h-[18px] w-[18px]"
        />
      </div>

      <div className="flex flex-1 flex-col justify-center px-3 py-3">
        <p className={cn('text-[12px] leading-[16px] font-medium', claimed ? 'text-[#065F46]' : 'text-[#9CA3AF]')}>
          {claimed ? 'Completed' : 'Tap to claim'}
        </p>
        <p className="mt-1 text-[15px] leading-[22px] font-medium text-[#111827]">{quest.title}</p>
        <p className="mt-0.5 text-[12px] text-[#6B7280]">{quest.description}</p>
        <p className="mt-1 flex items-center gap-1 text-[12px] font-medium text-[#238D9D]">
          <Image src={akibaMilesSymbol} alt="" width={12} height={12} className="h-3 w-3" />
          {quest.reward}
        </p>
      </div>
    </div>
  );
}

/* ─── Main component ─────────────────────────────────────── */

export default function MerchantDiscoveryQuests({
  openPopup,
}: {
  openPopup: (q: Quest) => void;
}) {
  const { address } = useWeb3();
  const { data: claimedSet = new Set<string>() } = useMerchantQuestClaimStatus(address!);

  return (
    <div className="mt-6">
      <h3 className="text-lg font-medium mb-1">Discover merchants</h3>
      <p className="mb-3 text-sm text-gray-500">Find where to spend your Miles</p>

      <div className="flex flex-col gap-2">
        {MERCHANT_DISCOVERY_QUESTS.map((quest) => (
          <QuestRow
            key={quest.id}
            quest={quest}
            claimed={claimedSet.has(quest.id)}
            onClick={() => openPopup(quest)}
          />
        ))}
      </div>
    </div>
  );
}
