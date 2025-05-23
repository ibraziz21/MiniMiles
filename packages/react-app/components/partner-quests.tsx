import { Cash, Celo, Door, GloDollar, Mento, MinimilesSymbol, MiniPay } from "@/lib/svg";
import { Lock } from "@phosphor-icons/react";
import Image from "next/image";
import Link from "next/link";
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
    id: '8d5a7766-4d2a-4bff-ac97-6b03fd5b570f',
    isLocked: true,
    img: Celo,
    title: "Celo",
    description: "Stake more than 5 Celo through Mondo.celo.org",
    reward: "15 MiniMiles",
    color: "#FFFFD6",
    actionLink: "https://mondo.celo.org",     // <-- where the button should go
    instructions: [
      { title: "Connect Wallet", text: "Open your wallet and select Celo network." },
      { title: "Stake", text: "Go to Mondo.celo.org and stake ≥ 5 CELO." },
    ],
  },
  {
    id: '99da9e3d-5332-419e-aa40-5cb9d6e3a7ab',
    isLocked: false,
    img: MinimilesSymbol,
    title: "MiniMiles",
    description: "Follow Us on Twitter",
    reward: "20 MiniMiles",
    color: "#B2DEC4",
    actionLink: "https://twitter.com/minimilesApp",
    instructions: [
      { title: "Open Twitter", text: "Go to our @minimilesApp page." },
      { title: "Follow", text: "Hit the Follow button and confirm." },
    ],
  },
  {
    id: '8d8ae13c-a4b0-47fa-aa30-4fdfc6d3032e',
    isLocked: true,
    img: GloDollar,
    title: "Pretium",
    description: "Use Pretium to Offramp or make a local payment",
    reward: "5 MiniMiles",
    color: "#24E5E033",
    actionLink: "https://twitter.com/pretium",
    instructions: [
      { title: "Open Pretium", text: "Open Pretium in your Minipay Mini Apps" },
      { title: "Offramp", text: "Buy Airtime, or make a local payment" },
    ],
  },
  {
    id: 'a487d06b-fe99-4f4f-91bb-532f1647a86c',
    img: Mento,
    isLocked: true,
    title: "Mento",
    description: "Swap Between Celo and a Stablecoin",
    reward: "15 MiniMiles",
    color: "#07955F1A",
    actionLink: "https://app.mento.org/",
    instructions: [
      { title: "Open Mento", text: "Go to our @minimilesApp page." },
      { title: "Swap", text: "Swap some Celo for any Stablecoin" },
    ],
  },
];

export default function PartnerQuests({ openPopup }: any) {
  return (
    <div className="mx-4 mt-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-bold">Partner Quests</h3>
        <Link href='/earn'>
          <span className="text-sm text-green-600 hover:underline font-bold">See all ›</span>
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-4">
        {quests.map((quest, index) => (
          <div onClick={() => openPopup(quest)} key={index} style={{ backgroundColor: quest.color }} className="rounded-xl p-4 h-[180px]">
            <div className="text-center flex flex-col justify-around w-full h-full items-center">
              <Image src={quest.img} alt="" className={`${quest.isLocked? "blur-sm" : null}`} />
              {quest.isLocked && (
                <div className="flex flex-col items-center justify-center text-white text-center">
                  <div className="bg-white rounded-full flex items-center py-1 px-3">
                    <Lock color="#07955F" className="w-4 h-4 mb-1 ml-2" />
                    <h4 className="text-[#07955F] text-sm">Coming Soon</h4>
                  </div>
                </div>
              )}
              <p className="text-sm font-semibold">{quest.title}</p>
              <p className="text-xs text-black mt-3 flex justify-center"><Image src={MinimilesSymbol} alt="" className="mr-2" /> {quest.reward}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
