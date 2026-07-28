'use client';

// "Discovery" quest group (discovery-quests-spec.md §5.2) — Platform-backed
// quests fed by the BFF in app/api/quests/platform, reusing the same status
// vocabulary and visual language PartnerQuests already established (locked/
// pending/claimable/claimed card states, check/lock icon + colored pill).
// Unlike partner quests, Discovery quests have no external action link or
// multi-step instructions to show — the triggering action already happened
// elsewhere (hub signup, a purchase, a voucher redemption, a sponsored game)
// — so a card either shows status or is directly tappable to claim, with no
// detail sheet in between.
import { akibaMilesSymbol } from '@/lib/svg';
import Image from 'next/image';
import cn from 'clsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWeb3 } from '@/contexts/useWeb3';
import { useState } from 'react';
import lockIcon from '@/public/svg/lock-icon.svg';
import checkIcon from '@/public/svg/check-icon.svg';

type PlatformQuestStatus = 'locked' | 'pending' | 'claimable' | 'claimed';

type PlatformQuest = {
  questId: string;
  name: string;
  description: string | null;
  rewardAmount: number;
  frequency: string;
  status: PlatformQuestStatus;
  rewardId: string | null;
};

function useDiscoveryQuests(address?: string) {
  return useQuery<PlatformQuest[]>({
    enabled: !!address,
    queryKey: ['discovery-quests', address],
    refetchOnMount: 'always',
    queryFn: async () => {
      const res = await fetch('/api/quests/platform', { cache: 'no-store' });
      if (!res.ok) return [];
      const body = await res.json() as { quests?: PlatformQuest[] };
      return body.quests ?? [];
    },
  });
}

export default function DiscoveryQuests({ onClaimed }: { onClaimed: () => void }) {
  const { address } = useWeb3();
  const { data: quests = [], isLoading } = useDiscoveryQuests(address ?? undefined);
  const queryClient = useQueryClient();
  const [claimingId, setClaimingId] = useState<string | null>(null);

  if (!address || isLoading || quests.length === 0) return null;

  const handleClaim = async (quest: PlatformQuest) => {
    if (!quest.rewardId || claimingId) return;
    setClaimingId(quest.questId);
    try {
      const res = await fetch('/api/quests/platform/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rewardId: quest.rewardId }),
      });
      if (res.ok) {
        onClaimed();
        queryClient.invalidateQueries({ queryKey: ['discovery-quests', address] });
      }
    } finally {
      setClaimingId(null);
    }
  };

  return (
    <div className="mt-6">
      <h3 className="text-lg font-medium mb-3">Discovery</h3>

      <div className="grid grid-cols-2 gap-3">
        {quests.map((quest) => {
          const claimable = quest.status === 'claimable';
          const claimed = quest.status === 'claimed';
          const pending = quest.status === 'pending';
          const locked = quest.status === 'locked';
          const isClaiming = claimingId === quest.questId;

          return (
            <button
              key={quest.questId}
              type="button"
              disabled={!claimable || isClaiming}
              onClick={() => claimable && handleClaim(quest)}
              className={cn(
                'relative flex h-[150px] w-full flex-col items-center justify-between rounded-xl border border-[#238D9D4D] bg-white p-4 text-left shadow-[0_6px_8px_0_rgba(0,0,0,0.15)]',
                claimable ? 'cursor-pointer active:opacity-80' : 'cursor-default',
              )}
            >
              <div className="flex flex-col items-center text-center">
                <h4 className="text-[14px] leading-[20px] font-medium text-black">{quest.name}</h4>
                {quest.description && (
                  <p className="mt-0.5 text-[11px] leading-[16px] text-[#9CA3AF]">{quest.description}</p>
                )}
              </div>

              <div className="flex items-center gap-1 text-[12px] text-[#6B7280]">
                <Image src={akibaMilesSymbol} alt="" width={12} height={12} className="h-3 w-3" />
                {quest.rewardAmount}
              </div>

              {claimed ? (
                <div className="flex items-center gap-1.5 rounded-full bg-[#D1FAE5] px-3 py-1">
                  <Image src={checkIcon} alt="" width={12} height={12} className="h-3 w-3" />
                  <span className="text-[12px] font-medium text-[#065F46]">Completed</span>
                </div>
              ) : pending ? (
                <div className="rounded-full bg-[#FEF3C7] px-3 py-1">
                  <span className="text-[12px] font-medium text-[#92400E]">Pending Verification</span>
                </div>
              ) : locked ? (
                <div className="flex items-center rounded-full bg-[#F3F4F6] px-3 py-1">
                  <Image src={lockIcon} alt="" width={12} height={12} className="mr-1.5 h-3 w-3" />
                  <span className="text-[12px] font-medium text-[#9CA3AF]">Not started</span>
                </div>
              ) : (
                <div className="rounded-full bg-[#ADF4FF80] px-3 py-1">
                  <span className="text-[12px] font-medium text-[#238D9D]">
                    {isClaiming ? 'Claiming…' : 'Tap to claim'}
                  </span>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
