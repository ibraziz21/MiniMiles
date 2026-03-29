'use client';

import {
  akibaMilesSymbol,
  akibaMilesSymbolAlt,
  MiniPay,
  Mento,
} from '@/lib/svg';
import celopg from '@/public/img/celopg.png';
import Image from 'next/image';
import cn from 'clsx';
import { createClient } from '@supabase/supabase-js';
import { useQuery } from '@tanstack/react-query';
import { useWeb3 } from '@/contexts/useWeb3';
import { useMemo, useState } from 'react';
import closeIcon from '@/public/svg/close-pass.svg';
import lockIcon from '@/public/svg/lock-icon.svg';
import checkIcon from '@/public/svg/check-icon.svg';
import { Sheet, SheetContent } from './ui/sheet';

export interface Quest {
  id: string;
  title: string;
  description: string;
  reward: string;
  color: string;
  instructions: { title: string; text: string }[];
  actionLink: string;
  isLocked: boolean;
}

/* ─── Quest IDs ──────────────────────────────────────────── */

const FOLLOW_ID   = '99da9e3d-5332-419e-aa40-5cb9d6e3a7ab';
const TELEGRAM_ID = '2679ab21-f8cf-446f-8efb-36b549f73fa0';

/* ─── Partner groups ─────────────────────────────────────── */

type PartnerGroup = {
  id: string;
  img: any;
  title: string;
  description: string;
  color: string;
  quests: Quest[];
};

const PARTNER_GROUPS: PartnerGroup[] = [
  {
    id: 'akibamiles',
    img: akibaMilesSymbolAlt,
    title: 'AkibaMiles',
    description: 'Follow & Join Community',
    color: '#238D9D1A',
    quests: [
      {
        id: FOLLOW_ID,
        isLocked: false,
        title: 'Follow on Twitter',
        description: 'Follow @akibaMilesApp on Twitter',
        reward: '5 akibaMiles',
        color: '#238D9D1A',
        actionLink: 'https://twitter.com/akibamiles',
        instructions: [
          { title: 'Open Twitter', text: 'Go to our @akibaMilesApp page.' },
          { title: 'Follow', text: 'Hit the Follow button and confirm.' },
        ],
      },
      {
        id: TELEGRAM_ID,
        isLocked: false,
        title: 'Join Telegram Group',
        description: 'Join the AkibaMiles Telegram community',
        reward: '5 akibaMiles',
        color: '#238D9D1A',
        actionLink: 'https://t.me/+kAqhzNJmBCZmYTZk',
        instructions: [
          { title: 'Open Telegram', text: 'Open the Telegram App' },
          { title: 'Join Group', text: 'Hit the Join Group button' },
        ],
      },
    ],
  },
  {
    id: 'minipay',
    img: MiniPay,
    title: 'MiniPay',
    description: 'Subscribe on YouTube',
    color: '#B3DEC5',
    quests: [
      {
        id: '1b15ef82-3a72-45c9-979a-2dbf317e8b26',
        isLocked: false,
        title: 'Subscribe on YouTube',
        description: 'Subscribe to the MiniPay YouTube Channel',
        reward: '5 akibaMiles',
        color: '#B3DEC5',
        actionLink: 'https://www.youtube.com/@MiniPay_wallet',
        instructions: [
          { title: 'Open YouTube', text: 'Go to the MiniPay YouTube Channel.' },
          { title: 'Subscribe', text: 'Hit the subscribe button and confirm.' },
        ],
      },
    ],
  },
  {
    id: 'celopg',
    img: celopg,
    title: 'Celo PG',
    description: 'Follow on X (Twitter)',
    color: '#FFFFD6',
    quests: [
      {
        id: '8d5a7766-4d2a-4bff-ac97-6b03fd5b570f',
        isLocked: false,
        title: 'Follow on X',
        description: 'Follow Celo PG on X (Twitter)',
        reward: '5 akibaMiles',
        color: '#FFFFD6',
        actionLink: 'https://x.com/CeloPublicGoods',
        instructions: [
          { title: 'Open Twitter', text: 'Go to @CeloPublicGoods page.' },
          { title: 'Follow', text: 'Hit the Follow button and confirm.' },
        ],
      },
    ],
  },
  {
    id: 'mento',
    img: Mento,
    title: 'Mento',
    description: 'Swap Celo & Stablecoins',
    color: '#238D9D1A',
    quests: [
      {
        id: 'a487d06b-fe99-4f4f-91bb-532f1647a86c',
        isLocked: true,
        title: 'Swap on Mento',
        description: 'Swap Between Celo and a Stablecoin',
        reward: '5 akibaMiles',
        color: '#238D9D1A',
        actionLink: 'https://app.mento.org/',
        instructions: [
          { title: 'Open Mento', text: 'Go to the Mento app.' },
          { title: 'Swap', text: 'Swap some Celo for any Stablecoin.' },
        ],
      },
    ],
  },
];

/* ─── Supabase hook ──────────────────────────────────────── */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

function useClaimedQuestIds(address?: string) {
  return useQuery<string[]>({
    enabled: !!address,
    queryKey: ['partner-claimed', address],
    queryFn: async () => {
      if (!address) return [];
      const { data } = await supabase
        .from('partner_engagements')
        .select('partner_quest_id')
        .eq('user_address', address.toLowerCase());
      return data?.map((d) => d.partner_quest_id) ?? [];
    },
  });
}

/* ─── Partner card ───────────────────────────────────────── */

function PartnerCard({
  group,
  claimedSet,
  onClick,
}: {
  group: PartnerGroup;
  claimedSet: Set<string>;
  onClick: () => void;
}) {
  const allLocked = group.quests.every((q) => q.isLocked);
  const totalSteps = group.quests.length;
  const completedSteps = group.quests.filter(
    (q) => !q.isLocked && claimedSet.has(q.id),
  ).length;
  const isCompleted = !allLocked && completedSteps >= totalSteps && totalSteps > 0;
  const isEmpty = completedSteps === 0;

  return (
    <button
      type="button"
      onClick={allLocked ? undefined : onClick}
      className={cn(
        'relative flex h-[180px] w-full flex-col items-center justify-between rounded-xl border border-[#238D9D4D] bg-white p-4 shadow-[0_6px_8px_0_rgba(0,0,0,0.15)] text-left',
        allLocked ? 'cursor-default opacity-80' : 'cursor-pointer',
      )}
    >
      {/* card content (blur when coming soon) */}
      <div className={cn('flex h-full w-full flex-col items-center justify-around text-center', allLocked && 'blur-sm')}>
        <div className="flex h-[42px] w-[42px] items-center justify-center">
          <Image
            src={group.img}
            alt={group.title}
            width={42}
            height={42}
            className={cn('h-[42px] w-[42px]', isEmpty && !allLocked && 'mix-blend-luminosity')}
          />
        </div>
        <div className="flex flex-col items-center text-center">
          <h3 className="text-[15px] leading-[22px] font-medium text-black">
            {group.title}
          </h3>
          <p className="mt-0.5 text-[11px] leading-[18px] text-[#9CA3AF]">
            {group.description}
          </p>
        </div>

        {isCompleted ? (
          <div className="flex items-center gap-1.5 rounded-full bg-[#D1FAE5] px-3 py-1">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#10B981] text-[10px] text-white">
              ✓
            </span>
            <span className="text-[12px] font-medium text-[#065F46]">Completed</span>
          </div>
        ) : (
          <div className="flex h-[6px] w-full items-center justify-between gap-[6px]">
            {Array.from({ length: totalSteps }).map((_, idx) => {
              const filled = idx < completedSteps;
              const bg = isEmpty ? '#E5E7EB' : filled ? '#16A34A' : '#D1D5DB';
              return (
                <span
                  key={idx}
                  className="h-[6px] flex-1 rounded-full"
                  style={{ backgroundColor: bg }}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Coming Soon overlay */}
      {allLocked && (
        <div className="absolute inset-0 flex items-center justify-center rounded-xl">
          <div className="flex items-center rounded-full bg-white/90 px-3 py-1.5 shadow-sm">
            <Image src={lockIcon} alt="" width={14} height={14} className="mr-1.5 h-[14px] w-[14px]" />
            <span className="text-xs font-medium text-[#238D9D]">Coming Soon</span>
          </div>
        </div>
      )}
    </button>
  );
}

/* ─── Partner detail sheet ───────────────────────────────── */

function PartnerDetailSheet({
  open,
  onOpenChange,
  group,
  claimedSet,
  onQuestClick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: PartnerGroup | null;
  claimedSet: Set<string>;
  onQuestClick: (q: Quest) => void;
}) {
  if (!group) return null;

  const allCompleted = group.quests.every(
    (q) => q.isLocked || claimedSet.has(q.id),
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="
          mx-auto
          w-full max-w-[420px]
          rounded-t-[24px] rounded-b-none
          bg-white
          p-0
          border-none
          max-h-[90vh]
          overflow-y-auto
          [&>button]:hidden
        "
      >
        <div className="px-6 pt-6 pb-8">
          {/* Top: icon + title + close */}
          <div className="flex w-full items-start gap-4">
            <div className="flex h-[58px] w-[58px] flex-shrink-0 items-center justify-center rounded-[8px] border border-[#E5E7EB]">
              <Image
                src={group.img}
                alt={group.title}
                width={38}
                height={38}
                className="h-[38px] w-[38px]"
              />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-[22px] leading-[28px] tracking-[-0.26px] font-semibold text-black">
                {group.title}
              </h2>
              <p className="text-[14px] text-[#6B7280]">{group.description}</p>
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="flex h-[58px] w-[24px] flex-shrink-0 items-start justify-end p-[3px]"
            >
              <Image src={closeIcon} alt="Close" width={18} height={18} className="mt-1" />
            </button>
          </div>

          {/* Divider */}
          <div className="mt-4 h-px w-full bg-[#E5E7EB]" />

          {/* All-done banner */}
          {allCompleted && (
            <div className="mt-4 flex w-full items-center justify-center rounded-full bg-[#D1FAE5] px-4 py-2">
              <Image src={checkIcon} alt="" width={16} height={16} className="mr-2 h-4 w-4" />
              <span className="text-sm font-medium text-[#065F46]">All quests completed!</span>
            </div>
          )}

          {/* Quest list */}
          <div className="mt-4 flex w-full flex-col gap-2">
            {group.quests.map((quest) => {
              const claimed = claimedSet.has(quest.id);
              const locked = quest.isLocked;
              const claimable = !locked && !claimed;

              return (
                <div
                  key={quest.id}
                  onClick={() => claimable && onQuestClick(quest)}
                  className={cn(
                    'flex min-h-[88px] w-full items-stretch rounded-[16px] border overflow-hidden bg-white',
                    claimed ? 'border-[#A7F3D0]' : 'border-[#E5E7EB]',
                    claimable ? 'cursor-pointer active:opacity-80' : 'cursor-default',
                  )}
                >
                  {/* LEFT: status icon column */}
                  <div
                    className={cn(
                      'flex self-stretch w-[48px] flex-shrink-0 items-center justify-center',
                      claimed ? 'bg-[#CFF2E5]' : 'bg-[#8080801A]',
                    )}
                  >
                    <Image
                      src={claimed ? checkIcon : lockIcon}
                      alt={claimed ? 'Completed' : locked ? 'Locked' : 'Available'}
                      width={18}
                      height={18}
                      className="h-[18px] w-[18px]"
                    />
                  </div>

                  {/* RIGHT: quest info */}
                  <div className="flex flex-1 flex-col justify-center bg-white px-3 py-3">
                    <p className="text-[12px] leading-[16px] font-medium text-[#9CA3AF]">
                      {locked ? 'Coming Soon' : claimed ? 'Completed' : 'Tap to claim'}
                    </p>
                    <p className="mt-1 text-[15px] leading-[22px] font-medium text-[#111827]">
                      {quest.title}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1 text-[12px] text-[#6B7280]">
                      <Image
                        src={akibaMilesSymbol}
                        alt=""
                        width={12}
                        height={12}
                        className="h-3 w-3"
                      />
                      {quest.reward}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ─── Main component ─────────────────────────────────────── */

export default function PartnerQuests({
  openPopup,
}: {
  openPopup: (q: Quest) => void;
}) {
  const { address } = useWeb3();
  const { data: claimedIds = [] } = useClaimedQuestIds(address!);
  const claimedSet = useMemo(() => new Set(claimedIds), [claimedIds]);

  const [selectedGroup, setSelectedGroup] = useState<PartnerGroup | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const handleQuestClick = (q: Quest) => {
    setDetailOpen(false);
    openPopup(q);
  };

  return (
    <div className="mt-6">
      <h3 className="text-lg font-medium mb-3">Partner Quests</h3>

      <div className="grid grid-cols-2 gap-3">
        {PARTNER_GROUPS.map((group) => (
          <PartnerCard
            key={group.id}
            group={group}
            claimedSet={claimedSet}
            onClick={() => {
              setSelectedGroup(group);
              setDetailOpen(true);
            }}
          />
        ))}
      </div>

      <PartnerDetailSheet
        open={detailOpen}
        onOpenChange={setDetailOpen}
        group={selectedGroup}
        claimedSet={claimedSet}
        onQuestClick={handleQuestClick}
      />
    </div>
  );
}
