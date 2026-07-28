'use client';

// Replaces components/partner-quests.tsx on the Earn page (spend-earn-redesign
// spec §2b). Same quest engine (partner_quests / partner_engagements /
// eligibility+claim API + QuestClaimSheet-family UI), new catalog: merchant
// discovery instead of partner-app follows. partner-quests.tsx stays mounted
// nowhere but is kept in the tree — see open question #2 in the spec.

import Image from 'next/image';
import cn from 'clsx';
import { akibaMilesSymbol } from '@/lib/svg';
import checkIcon from '@/public/svg/check-icon.svg';
import lockIcon from '@/public/svg/lock-icon.svg';
import {
  QUEST_AKIBA_PASS,
  QUEST_BROWSE_DEALS,
  QUEST_SPONSORED_LEADERBOARD,
  QUEST_COMPLETE_PROFILE,
  QUEST_REDEEM_VOUCHER,
  type MerchantQuestStatus,
  type MerchantQuestStatusState,
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

/* ─── Quest row ───────────────────────────────────────────── */

type MerchantQuestDisplayState =
  | 'start'
  | 'action-required'
  | 'ready'
  | 'queued'
  | 'failed'
  | 'completed';

const STATE_LABELS: Record<MerchantQuestDisplayState, string> = {
  start: 'Start quest',
  'action-required': 'Action required',
  ready: 'Ready to claim',
  queued: 'Reward queued',
  failed: 'Reward needs attention',
  completed: 'Completed',
};

function QuestRow({
  quest,
  state,
  onClick,
}: {
  quest: Quest;
  state: MerchantQuestDisplayState;
  onClick: () => void;
}) {
  const claimed = state === 'completed';
  const queued = state === 'queued';
  const failed = state === 'failed';
  const disabled = claimed || queued;

  return (
    <button
      type="button"
      onClick={!disabled ? onClick : undefined}
      disabled={disabled}
      className={cn(
        'flex min-h-[80px] w-full items-stretch overflow-hidden rounded-[16px] border bg-white text-left',
        claimed
          ? 'border-[#A7F3D0]'
          : queued
          ? 'border-[#BAE6FD]'
          : failed
          ? 'border-[#FCA5A5]'
          : 'border-[#E5E7EB]',
        !disabled && 'cursor-pointer active:opacity-80',
      )}
    >
      <div
        className={cn(
          'flex self-stretch w-[48px] shrink-0 items-center justify-center',
          claimed
            ? 'bg-[#CFF2E5]'
            : queued
            ? 'bg-[#E0F2FE]'
            : failed
            ? 'bg-[#FEE2E2]'
            : 'bg-[#8080801A]',
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
        <p
          className={cn(
            'text-[12px] leading-[16px] font-medium',
            claimed
              ? 'text-[#065F46]'
              : queued
              ? 'text-[#0369A1]'
              : failed
              ? 'text-[#B91C1C]'
              : state === 'action-required'
              ? 'text-[#B45309]'
              : 'text-[#6B7280]',
          )}
        >
          {STATE_LABELS[state]}
        </p>
        <p className="mt-1 text-[15px] leading-[22px] font-medium text-[#111827]">{quest.title}</p>
        <p className="mt-0.5 text-[12px] text-[#6B7280]">{quest.description}</p>
        <p className="mt-1 flex items-center gap-1 text-[12px] font-medium text-[#238D9D]">
          <Image src={akibaMilesSymbol} alt="" width={12} height={12} className="h-3 w-3" />
          {quest.reward}
        </p>
      </div>
    </button>
  );
}

/* ─── Main component ─────────────────────────────────────── */

export default function MerchantDiscoveryQuests({
  openPopup,
  showCompleted = false,
  startedQuestIds = [],
  queuedQuestIds = [],
  actionRequiredQuestIds = [],
  enabled = false,
  statusRows = [],
}: {
  openPopup: (q: Quest, state?: MerchantQuestStatusState) => void;
  showCompleted?: boolean;
  startedQuestIds?: string[];
  queuedQuestIds?: string[];
  actionRequiredQuestIds?: string[];
  enabled?: boolean;
  statusRows?: MerchantQuestStatus[];
}) {
  if (!enabled) return null;

  const statusByQuest = new Map<string, MerchantQuestStatus>(
    statusRows.map((status) => [status.questId, status]),
  );
  const startedSet = new Set(startedQuestIds);
  const queuedSet = new Set(queuedQuestIds);
  const actionRequiredSet = new Set(actionRequiredQuestIds);
  const visibleQuests = MERCHANT_DISCOVERY_QUESTS.filter((quest) =>
    showCompleted
      ? statusByQuest.get(quest.id)?.state === 'completed'
      : statusByQuest.get(quest.id)?.state !== 'completed',
  );

  const stateForQuest = (questId: string): MerchantQuestDisplayState => {
    const serverState = statusByQuest.get(questId)?.state;
    if (serverState === 'completed') return 'completed';
    if (serverState === 'failed') return 'failed';
    if (serverState === 'queued') return 'queued';
    if (queuedSet.has(questId)) return 'queued';
    if (serverState === 'eligible') return 'ready';
    if (actionRequiredSet.has(questId)) return 'action-required';
    if (startedSet.has(questId)) return 'action-required';
    return 'start';
  };

  return (
    <div className="mt-6">
      <h3 className="text-lg font-medium mb-1">
        {showCompleted ? 'Merchant quests' : 'Discover merchants'}
      </h3>
      <p className="mb-3 text-sm text-gray-500">
        {showCompleted ? 'Your completed merchant activities' : 'Find where to spend your Miles'}
      </p>

      <div className="flex flex-col gap-2">
        {visibleQuests.map((quest) => (
          <QuestRow
            key={quest.id}
            quest={quest}
            state={stateForQuest(quest.id)}
            onClick={() => openPopup(quest, statusByQuest.get(quest.id)?.state)}
          />
        ))}
        {showCompleted && visibleQuests.length === 0 && (
          <div className="rounded-2xl border border-dashed border-[#D1D5DB] bg-white px-4 py-6 text-center">
            <p className="text-sm text-[#6B7280]">No merchant quests completed yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}
