'use client';

import {
  Cash,
  Celo,
  Door,
  GloDollar,
  SYR,
  Mento,
  akibaMilesSymbol,
  akibaMilesSymbolAlt,
  MiniPay,
  W3MLogo,
} from '@/lib/svg';
import { Check, Lock } from '@phosphor-icons/react';
import Image from 'next/image';
import cn from 'clsx';
import { createClient } from '@supabase/supabase-js';
import { useQuery } from '@tanstack/react-query';
import { useWeb3 } from '@/contexts/useWeb3';
import { useMemo } from 'react';

export interface Quest {
  id: string;
  img: any;
  title: string;
  description: string;
  reward: string;
  color: string;
  instructions: { title: string; text: string }[];
  actionLink: string;
  isLocked: boolean;
}

/* ─── Akiba quest IDs (3-step flow) ──────────────────────── */
const FOLLOW_ID = '99da9e3d-5332-419e-aa40-5cb9d6e3a7ab'; // Follow Twitter
const TELEGRAM_ID = '2679ab21-f8cf-446f-8efb-36b549f73fa0'; // Join Telegram
const USERNAME_ID = 'f18818cf-eec4-412e-8311-22e09a1332db'; // Set username

const quests: Quest[] = [
  {
    id: FOLLOW_ID,
    isLocked: false,
    img: akibaMilesSymbolAlt,
    title: 'akibaMiles',
    description: 'Follow Us on Twitter',
    reward: '20 akibaMiles',
    color: '#238D9D1A',
    actionLink: 'https://twitter.com/akibamiles',
    instructions: [
      { title: 'Open Twitter', text: 'Go to our @akibaMilesApp page.' },
      { title: 'Follow', text: 'Hit the Follow button and confirm.' },
    ],
  },
  {
    id: '1b15ef82-3a72-45c9-979a-2dbf317e8b26',
    isLocked: false,
    img: MiniPay,
    title: 'MiniPay',
    description: 'Subscribe to the Minipay Youtube Channel',
    reward: '25 akibaMiles',
    color: '#B3DEC5',
    actionLink: 'https://www.youtube.com/@MiniPay_wallet',
    instructions: [
      { title: 'Open Youtube', text: 'Go to the Minipay Youtube Channel.' },
      { title: 'Subscribe', text: 'Hit the subscribe button and confirm.' },
    ],
  },
  {
    id: TELEGRAM_ID,
    isLocked: false,
    img: akibaMilesSymbolAlt,
    title: 'AkibaMiles',
    description: 'Join the Telegram Group',
    reward: '20 akibaMiles',
    color: '#238D9D1A',
    actionLink: 'https://t.me/+kAqhzNJmBCZmYTZk',
    instructions: [
      { title: 'Open Telegram', text: 'Open the Telegram App' },
      { title: 'Join Group', text: 'Hit the Join Group button' },
    ],
  },
  // 👇 username quest – part of the same Akiba slot (3rd step)
  {
    id: USERNAME_ID,
    isLocked: false,
    img: akibaMilesSymbolAlt,
    title: 'AkibaMiles',
    description: 'Set your Akiba username',
    reward: '10 akibaMiles',
    color: '#238D9D1A',
    actionLink: '', // handled inside sheet – no external link
    instructions: [], // we ignore instructions for this one in the sheet
  },
  {
    id: '8d5a7766-4d2a-4bff-ac97-6b03fd5b570f',
    isLocked: false,
    img: Celo,
    title: 'Celo PG',
    description: 'Follow Celo PG on X (Twitter)',
    reward: '20 akibaMiles',
    color: '#FFFFD6',
    actionLink: 'https://x.com/CeloPublicGoods',
    instructions: [
      { title: 'Open Twitter', text: 'Go to @CeloPublicGoods page.' },
      { title: 'Follow', text: 'Hit the Follow button and confirm.' },
    ],
  },
  {
    id: 'a487d06b-fe99-4f4f-91bb-532f1647a86c',
    img: Mento,
    isLocked: true,
    title: 'Mento',
    description: 'Swap Between Celo and a Stablecoin',
    reward: '15 akibaMiles',
    color: '#238D9D1A',
    actionLink: 'https://app.mento.org/',
    instructions: [
      { title: 'Open Mento', text: 'Go to the Mento app.' },
      { title: 'Swap', text: 'Swap some Celo for any Stablecoin.' },
    ],
  },
];

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_SERVICE_KEY!,
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
        .eq('user_address', address);
      return data?.map((d) => d.partner_quest_id) ?? [];
    },
  });
}

export default function PartnerQuests({
  openPopup,
}: {
  openPopup: (q: Quest) => void;
}) {
  const { address } = useWeb3();
  const { data: claimedIds = [] } = useClaimedQuestIds(address!);
  const claimedSet = new Set(claimedIds);

  const displayQuests = useMemo(() => {
    const list = [...quests];

    // All Akiba stage IDs in order
    const akibaIds = [FOLLOW_ID, TELEGRAM_ID, USERNAME_ID];

    // Find the index of the FIRST Akiba card in the list – this slot will be reused
    const baseIdx = list.findIndex((q) => akibaIds.includes(q.id));
    if (baseIdx === -1) return list; // safeguard

    // Decide which Akiba quest to show in that slot:
    // - if Follow not done → show Follow
    // - else if Telegram not done → show Telegram
    // - else → show Username (even if completed, so it can show "Completed")
    let currentAkibaId: string;
    if (!claimedSet.has(FOLLOW_ID)) {
      currentAkibaId = FOLLOW_ID;
    } else if (!claimedSet.has(TELEGRAM_ID)) {
      currentAkibaId = TELEGRAM_ID;
    } else {
      currentAkibaId = USERNAME_ID;
    }

    const currentAkibaQuest = quests.find((q) => q.id === currentAkibaId);
    if (!currentAkibaQuest) return list;

    // Put the chosen Akiba quest in the base slot
    list[baseIdx] = currentAkibaQuest;

    // Remove the other Akiba quests from the rest of the list so we only get one card
    return list.filter((q, idx) => {
      if (idx === baseIdx) return true;
      return !akibaIds.includes(q.id);
    });
  }, [claimedSet]);

  return (
    <div className="mt-6">
      <h3 className="text-lg font-medium mb-3">Partner Quests</h3>

      <div className="grid grid-cols-2 gap-2">
        {displayQuests.map((q: Quest) => {
          const locked = q.isLocked;
          let completed: boolean | undefined;
          if (!locked) {
            completed = claimedSet.has(q.id);
          }

          const clickable = !locked && !completed;

          return (
            <div
              key={q.id}
              onClick={() => clickable && openPopup(q)}
              style={{ backgroundColor: q.color }}
              className={cn(
                'relative flex h-[180px] flex-col items-center justify-between rounded-xl p-4',
                clickable ? 'cursor-pointer' : 'cursor-default',
                locked || completed ? 'opacity-80' : '',
              )}
            >
              {/* inner content (blurred if locked or completed) */}
              <div
                className={cn(
                  'flex h-full flex-col items-center justify-around text-center transition',
                  locked || completed ? 'blur-sm' : '',
                )}
              >
                <Image src={q.img} alt={q.title} className="h-[64px] w-[64px]" />
                <p className="text-sm font-medium">{q.title}</p>
                <p className="mt-1 flex items-center justify-center text-xs font-poppins">
                  <Image
                    src={akibaMilesSymbol}
                    alt=""
                    width={16}
                    height={16}
                    className="mr-1"
                  />
                  {q.reward}
                </p>
              </div>

              {/* overlay – locked */}
              {locked && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="flex items-center rounded-full bg-white/90 p-1">
                    <Lock
                      size={16}
                      color="#238D9D"
                      weight="bold"
                      className="mr-1"
                    />
                    <span className="text-xs font-medium text-[#238D9D]">
                      Coming Soon
                    </span>
                  </div>
                </div>
              )}

              {/* overlay – completed */}
              {completed && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="flex items-center rounded-full bg-white/90 p-1">
                    <Check
                      size={16}
                      color="#16a34a"
                      weight="bold"
                      className="mr-1"
                    />
                    <span className="text-xs font-medium text-[#16a34a]">
                      Completed
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
