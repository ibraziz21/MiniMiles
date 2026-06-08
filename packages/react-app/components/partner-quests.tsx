'use client';

import {
  akibaMilesSymbol,
  akibaMilesSymbolAlt,
  MiniPay,
  Mento,
} from '@/lib/svg';
import celopg from '@/public/img/celopg.png';
import girasolonchain from '@/public/img/girasolonchain.png';
import predictionfrontier from '@/public/img/predictionF.jpg';
import pretiumLogo from '@/public/img/pretium.jpg';
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
  /** Set for quests that require external verification before miles are minted */
  questType?: 'pretium_signup' | 'pretium_transact';
}

/* ─── Quest IDs ──────────────────────────────────────────── */

const FOLLOW_ID    = '99da9e3d-5332-419e-aa40-5cb9d6e3a7ab';
const TELEGRAM_ID  = '2679ab21-f8cf-446f-8efb-36b549f73fa0';
const YOUTUBE_ID   = '5405c0bb-03de-4b7a-80e1-c28982dcfbc2';
const TIKTOK_ID    = 'c3d24b83-de1e-465f-b703-f52895f73a03';

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
    id: 'prediction-frontier',
    img: predictionfrontier,
    title: 'Prediction Frontier',
    description: 'Learn and Get the latest news about Prediction Markets',
    color: '#FFFFD6',
    quests: [
      {
        id: 'f0678b77-01f0-4ad7-a078-a30985a57306',
        isLocked: false,
        title: 'Subscribe on YouTube',
        description: 'Subscribe to Prediction Frontier on YouTube',
        reward: '10 akibaMiles',
        color: '#FFFFD6',
        actionLink: 'https://www.youtube.com/@PredictionFrontier',
        instructions: [
          { title: 'Open YouTube', text: 'Go to the Prediction Frontier YouTube Channel.' },
          { title: 'Follow', text: 'Hit the Follow button and confirm.' },
        ],
      },
      {
        id: 'b750f186-a239-4be0-ab55-ef6039c4042d',
        isLocked: false,
        title: 'Follow on X',
        description: 'Follow Prediction Frontier on X (Twitter)',
        reward: '10 akibaMiles',
        color: '#FFFFD6',
        actionLink: 'https://x.com/info_prediction',
        instructions: [
          { title: 'Open X', text: 'Go to the Prediction Frontier X (Twitter) profile.' },
          { title: 'Follow', text: 'Hit the Follow button and confirm.' },
        ],
      },
       {
        id: '123e5379-b5a8-4e73-b70a-ba5370adba92',
        isLocked: false,
        title: 'Follow on Tiktok',
        description: 'Follow Prediction Frontier on Tiktok',
        reward: '10 akibaMiles',
        color: '#FFFFD6',
        actionLink: 'https://www.tiktok.com/@predictionfrontier?_r=1&_t=ZS-96wwfHgTi6B',
        instructions: [
          { title: 'Open Tiktok', text: 'Go to the Prediction Frontier Tiktok profile.' },
          { title: 'Follow', text: 'Hit the Follow button and confirm.' },
        ],
      },
      {
        id: '1faedd58-339c-4497-95bc-9f606890f0f3',
        isLocked: false,
        title: 'Follow on Instagram',
        description: 'Follow Prediction Frontier on Instagram',
        reward: '10 akibaMiles',
        color: '#FFFFD6',
        actionLink: 'https://www.instagram.com/predictionfrontier?igsh=dzloeDQxaGhyZTlw',
        instructions: [
          { title: 'Open Instagram', text: 'Go to the Prediction Frontier Instagram profile.' },
          { title: 'Follow', text: 'Hit the Follow button and confirm.' },
        ],
      },
    ],
  },
    {
    id: 'pretium',
    img: pretiumLogo,
    title: 'Pretium',
    description: 'Sign up with code AKIBA1 & earn miles',
    color: '#EEF6FF',
    quests: [
      {
        id: 'pretium_signup',
        questType: 'pretium_signup',
        isLocked: false,
        title: 'Sign Up to Pretium',
        description: 'Download Pretium & sign up using referral code AKIBA1. Miles awarded after Pretium verifies your account.',
        reward: '50 akibaMiles',
        color: '#EEF6FF',
        actionLink: 'https://play.google.com/store/apps/details?id=app.pretium.finance',
        instructions: [
          { title: 'Download Pretium', text: 'Tap the button below to get the Pretium app on the Play Store.' },
          { title: 'Use code AKIBA1', text: 'You MUST enter referral code AKIBA1 during sign-up — accounts registered without it cannot be verified.' },
          { title: 'Submit here', text: 'Come back and tap Submit. Pretium verifies accounts daily — miles arrive within 24 hours of confirmation.' },
        ],
      },
      {
        id: 'pretium_transact',
        questType: 'pretium_transact',
        isLocked: false,
        title: 'Transact on Pretium',
        description: 'Make any transaction on Pretium. Miles awarded after Pretium verifies the activity.',
        reward: '50 akibaMiles',
        color: '#EEF6FF',
        actionLink: 'https://play.google.com/store/apps/details?id=app.pretium.finance',
        instructions: [
          { title: 'Open Pretium', text: 'Log in to the Pretium app (must have signed up with code AKIBA1).' },
          { title: 'Transact', text: 'Send, receive, or convert — any on-platform transaction counts.' },
          { title: 'Submit here', text: 'Come back and tap Submit. Pretium verifies activity daily — miles arrive within 24 hours of confirmation.' },
        ],
      },
    ],
  },
  {
    id: 'girasolonchain',
    img: girasolonchain,
    title: 'Girasol OnChain',
    description: 'Powering crypto and fiat flows in LatAm & Caribbean',
    color: '#238D9D1A',
    quests: [
       {
        id: '1b6f3010-80b8-4387-87e9-435427cce258',
        isLocked: false,
        title: 'Follow on X',
        description: 'Follow Girasol OnChain on X (Twitter)',
        reward: '10 akibaMiles',
        color: '#FFFFD6',
        actionLink: 'https://x.com/girasolonchain',
        instructions: [
          { title: 'Open X', text: 'Go to the Prediction Frontier X (Twitter) profile.' },
          { title: 'Follow', text: 'Hit the Follow button and confirm.' },
        ],
      },
    ],
  },
  {
    id: 'akibamiles',
    img: akibaMilesSymbolAlt,
    title: 'AkibaMiles',
    description: 'Follow, Join & Subscribe',
    color: '#238D9D1A',
    quests: [
      {
        id: FOLLOW_ID,
        isLocked: false,
        title: 'Follow on x',
        description: 'Follow @akibaMilesApp on X',
        reward: '5 akibaMiles',
        color: '#238D9D1A',
        actionLink: 'https://x.com/akibamiles',
        instructions: [
          { title: 'Open X', text: 'Go to our @akibaMilesApp page.' },
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
      {
        id: YOUTUBE_ID,
        isLocked: false,
        title: 'Subscribe on YouTube',
        description: 'Subscribe to the AkibaMiles YouTube channel',
        reward: '20 akibaMiles',
        color: '#238D9D1A',
        actionLink: 'https://www.youtube.com/channel/UC3zx6mtu-eDDxG3EkEbZldw',
        instructions: [
          { title: 'Open YouTube', text: 'Go to the AkibaMiles YouTube channel.' },
          { title: 'Subscribe', text: 'Hit the Subscribe button and confirm.' },
        ],
      },
      {
        id: TIKTOK_ID,
        isLocked: false,
        title: 'Follow on TikTok',
        description: 'Follow AkibaMiles on TikTok',
        reward: '20 akibaMiles',
        color: '#238D9D1A',
        actionLink: 'https://www.tiktok.com/@akibamiles',
        instructions: [
          { title: 'Open TikTok', text: 'Go to the @akibamiles profile page.' },
          { title: 'Follow', text: 'Hit the Follow button and confirm.' },
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
  }
];

/* ─── Supabase hook ──────────────────────────────────────── */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

type ClaimStatus = { claimed: string[]; pending: string[] };

function useQuestClaimStatus(address?: string) {
  return useQuery<ClaimStatus>({
    enabled: !!address,
    queryKey: ['partner-claimed', address],
    refetchOnMount: 'always',
    queryFn: async () => {
      if (!address) return { claimed: [], pending: [] };
      const addrLc = address.toLowerCase();

      const [{ data: engagements }, pretiumRes] = await Promise.all([
        supabase.from('partner_engagements').select('partner_quest_id').eq('user_address', addrLc),
        fetch('/api/partner-quests/pretium/status').then((r) => r.ok ? r.json() as Promise<Record<string, string | null>> : Promise.resolve({} as Record<string, string | null>)),
      ]);

      const claimed = engagements?.map((d) => d.partner_quest_id) ?? [];
      const pending: string[] = [];

      for (const questType of ['signup', 'transact'] as const) {
        const status = pretiumRes?.[questType];
        if (status) {
          claimed.push(`pretium_${questType}`);
          if (status !== 'confirmed') pending.push(`pretium_${questType}`);
        }
      }

      return { claimed, pending };
    },
  });
}

/* ─── Partner card ───────────────────────────────────────── */

function PartnerCard({
  group,
  claimedSet,
  pendingSet,
  onClick,
}: {
  group: PartnerGroup;
  claimedSet: Set<string>;
  pendingSet: Set<string>;
  onClick: () => void;
}) {
  const allLocked = group.quests.every((q) => q.isLocked);
  const totalSteps = group.quests.length;
  const completedSteps = group.quests.filter(
    (q) => !q.isLocked && claimedSet.has(q.id),
  ).length;
  const hasPending = group.quests.some((q) => pendingSet.has(q.id));
  const isCompleted = !allLocked && completedSteps >= totalSteps && totalSteps > 0 && !hasPending;
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
        ) : hasPending ? (
          <div className="flex items-center gap-1.5 rounded-full bg-[#FEF3C7] px-3 py-1">
            <span className="text-[12px] font-medium text-[#92400E]">Pending Verification</span>
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
  pendingSet,
  onQuestClick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: PartnerGroup | null;
  claimedSet: Set<string>;
  pendingSet: Set<string>;
  onQuestClick: (q: Quest) => void;
}) {
  if (!group) return null;

  const allCompleted =
    group.quests.every((q) => q.isLocked || claimedSet.has(q.id)) &&
    !group.quests.some((q) => pendingSet.has(q.id));

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
              const pending = pendingSet.has(quest.id);
              const locked = quest.isLocked;
              const claimable = !locked && !claimed;

              const borderColor = pending
                ? 'border-[#FCD34D]'
                : claimed
                ? 'border-[#A7F3D0]'
                : 'border-[#E5E7EB]';

              const iconBg = pending
                ? 'bg-[#FEF3C7]'
                : claimed
                ? 'bg-[#CFF2E5]'
                : 'bg-[#8080801A]';

              const statusLabel = locked
                ? 'Coming Soon'
                : pending
                ? 'Pending Verification'
                : claimed
                ? 'Completed'
                : 'Tap to claim';

              const statusColor = pending ? 'text-[#92400E]' : 'text-[#9CA3AF]';

              return (
                <div
                  key={quest.id}
                  onClick={() => claimable && onQuestClick(quest)}
                  className={cn(
                    'flex min-h-[88px] w-full items-stretch rounded-[16px] border overflow-hidden bg-white',
                    borderColor,
                    claimable ? 'cursor-pointer active:opacity-80' : 'cursor-default',
                  )}
                >
                  {/* LEFT: status icon column */}
                  <div
                    className={cn(
                      'flex self-stretch w-[48px] flex-shrink-0 items-center justify-center',
                      iconBg,
                    )}
                  >
                    <Image
                      src={claimed && !pending ? checkIcon : lockIcon}
                      alt={statusLabel}
                      width={18}
                      height={18}
                      className="h-[18px] w-[18px]"
                    />
                  </div>

                  {/* RIGHT: quest info */}
                  <div className="flex flex-1 flex-col justify-center bg-white px-3 py-3">
                    <p className={cn('text-[12px] leading-[16px] font-medium', statusColor)}>
                      {statusLabel}
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
  localPendingIds = [],
}: {
  openPopup: (q: Quest) => void;
  localPendingIds?: string[];
}) {
  const { address } = useWeb3();
  const { data: claimStatus = { claimed: [], pending: [] } } = useQuestClaimStatus(address!);
  const claimedSet = useMemo(() => {
    const s = new Set(claimStatus.claimed);
    localPendingIds.forEach((id) => s.add(id));
    return s;
  }, [claimStatus.claimed, localPendingIds]);
  const pendingSet = useMemo(() => {
    const s = new Set(claimStatus.pending);
    localPendingIds.forEach((id) => s.add(id));
    return s;
  }, [claimStatus.pending, localPendingIds]);

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
            pendingSet={pendingSet}
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
        pendingSet={pendingSet}
        onQuestClick={handleQuestClick}
      />
    </div>
  );
}
