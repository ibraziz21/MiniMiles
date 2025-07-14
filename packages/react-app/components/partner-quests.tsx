import { Cash, Celo, Door, GloDollar, Mento, akibaMilesSymbol, akibaMilesSymbolAlt, MiniPay, W3MLogo  } from "@/lib/svg";
import { Check, Lock } from "@phosphor-icons/react";
import Image from "next/image";
import Link from "next/link";
import cn from 'clsx'
import { createClient } from "@supabase/supabase-js";
import { useQuery } from "@tanstack/react-query";
import { useWeb3 } from "@/contexts/useWeb3";
// components/DailyChallenges.tsx
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

const quests: Quest[] = [
  {
    id: '99da9e3d-5332-419e-aa40-5cb9d6e3a7ab',
    isLocked: false,
    img: akibaMilesSymbolAlt,
    title: "akibaMiles",
    description: "Follow Us on Twitter",
    reward: "20 akibaMiles",
    color: "#238D9D",
    actionLink: "https://twitter.com/akibamiles",
    instructions: [
      { title: "Open Twitter", text: "Go to our @akibaMilesApp page." },
      { title: "Follow", text: "Hit the Follow button and confirm." },
    ],
  },
  {
    id: '5cb7f990-1db6-4c99-8236-804b78dadb63',
    isLocked: false,
    img: W3MLogo,
    title: "Web3 Mashinani",
    description: "Follow Us on Twitter",
    reward: "20 akibaMiles",
    color: "#f7f5f2",
    actionLink: "https://twitter.com/web3mashinani",
    instructions: [
      { title: "Open Twitter", text: "Go to our @web3mashinani page." },
      { title: "Follow", text: "Hit the Follow button and confirm." },
    ],
  },
  {
    id: '8d5a7766-4d2a-4bff-ac97-6b03fd5b570f',
    isLocked: true,
    img: Celo,
    title: "Celo",
    description: "Stake more than 5 Celo through Mondo.celo.org",
    reward: "15 akibaMiles",
    color: "#FFFFD6",
    actionLink: "https://mondo.celo.org",     // <-- where the button should go
    instructions: [
      { title: "Connect Wallet", text: "Open your wallet and select Celo network." },
      { title: "Stake", text: "Go to Mondo.celo.org and stake ≥ 5 CELO." },
    ],
  },

  // {
  //   id: '8d8ae13c-a4b0-47fa-aa30-4fdfc6d3032e',
  //   isLocked: true,
  //   img: GloDollar,
  //   title: "GloDollar",
  //   description: "Use Pretium to Offramp or make a local payment",
  //   reward: "15 akibaMiles",
  //   color: "#24E5E033",
  //   actionLink: "https://twitter.com/pretium",
  //   instructions: [
  //     { title: "Open Pretium", text: "Open Pretium in your Minipay Mini Apps" },
  //     { title: "Offramp", text: "Buy Airtime, or make a local payment" },
  //   ],
  // },
  {
    id: 'a487d06b-fe99-4f4f-91bb-532f1647a86c',
    img: Mento,
    isLocked: true,
    title: "Mento",
    description: "Swap Between Celo and a Stablecoin",
    reward: "15 akibaMiles",
    color: "#238D9D1A",
    actionLink: "https://app.mento.org/",
    instructions: [
      { title: "Open Mento", text: "Go to our @akibaMilesApp page." },
      { title: "Swap", text: "Swap some Celo for any Stablecoin" },
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
      if (!address) return []
      const { data } = await supabase
        .from('partner_engagements')
        .select('partner_quest_id')
        .eq('user_address', address)
      return data?.map((d) => d.partner_quest_id) ?? []
    },
  })
}

export default function PartnerQuests({
  openPopup,
}: {
  openPopup: (q: Quest) => void
}) {
  const { address } = useWeb3()
  const { data: claimedIds = [] } = useClaimedQuestIds(address!)
  const claimedSet = new Set(claimedIds)

  return (
    <div className="mt-6">
      <h3 className="text-lg font-medium mb-3">Partner Quests</h3>

      <div className="grid grid-cols-2 gap-2">
        {quests.map((q) => {
          const locked     = q.isLocked
          let completed
          if(!locked){
           completed  = claimedSet.has(q.id)
          }

          /* card click only when active */
          const clickable = !locked && !completed

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
              {/* inner content (blurred if locked) */}
              <div
                className={cn(
                  'flex h-full flex-col items-center justify-around text-center transition',
                  locked || completed ? 'blur-sm' : '',
                )}
              >
                <Image
                  src={q.img}
                  alt={q.title}
                  className="h-[64px] w-[64px]"
                />
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
          )
        })}
      </div>
    </div>
  )
}