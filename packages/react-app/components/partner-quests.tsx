import { Cash, Celo, Door, GloDollar, Mento, MinimilesSymbol, MiniPay } from "@/lib/svg";
import Image from "next/image";
import Link from "next/link";
// components/DailyChallenges.tsx
export interface Quest {
  img: any;
  title: string;
  description: string;
  reward: string;
  color: string;
  instructions: { title: string; text: string }[];
  actionLink: string;
}

const quests: Quest[] = [
  {
    img: Celo,
    title: "Celo",
    description: "Stake more than 5 Celo through Mondo.celo.org",
    reward: "15 MiniMiles",
    color: "#FFFFD6",
    actionLink: "https://mondo.celo.org",     // <-- where the button should go
    instructions: [
      { title: "Connect Wallet", text: "Open your wallet and select Celo network." },
      { title: "Stake",      text: "Go to Mondo.celo.org and stake ≥ 5 CELO." },
    ],
  },
  {
    img: MinimilesSymbol,
    title: "MiniMiles",
    description: "Follow Us on Twitter",
    reward: "20 MiniMiles",
    color: "#B2DEC4",
    actionLink: "https://twitter.com/minimilesApp",
    instructions: [
      { title: "Open Twitter", text: "Go to our @minimilesApp page." },
      { title: "Follow",      text: "Hit the Follow button and confirm." },
    ],
  },
  {
    img: GloDollar,
    title: "Pretium",
    description: "Use Pretium to Offramp or make a local payment",
    reward: "5 MiniMiles",
    color: "#24E5E033",
    actionLink: "https://twitter.com/pretium",
    instructions: [
      { title: "Open Pretium", text: "Open Pretium in your Minipay Mini Apps" },
      { title: "Offramp",      text: "Buy Airtime, or make a local payment" },
    ],
  },
  {
    img: Mento,
    title: "Mento",
    description: "Swap Between Celo and a Stablecoin",
    reward: "15 MiniMiles",
    color: "#07955F1A",
    actionLink: "https://app.mento.org/",
    instructions: [
      { title: "Open Mento", text: "Go to our @minimilesApp page." },
      { title: "Swap",      text: "Swap some Celo for any Stablecoin" },
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
              <Image src={quest.img} alt="" />
              <p className="text-sm font-semibold">{quest.title}</p>
              <p className="text-xs text-black mt-3 flex justify-center"><Image src={MinimilesSymbol} alt="" className="mr-2" /> {quest.reward}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
