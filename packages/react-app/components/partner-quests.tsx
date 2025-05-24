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
    id: '8d8ae13c-a4b0-47fa-aa30-4fdfc6d3032e',
    isLocked: true,
    img: GloDollar,
    title: "GloDollar",
    description: "Use Pretium to Offramp or make a local payment",
    reward: "15 MiniMiles",
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

export default function PartnerQuests({
  openPopup,
}: {
  openPopup: (q: Quest) => void;
}) {
  return (
    <div className="mx-4 mt-6">
      <h3 className="text-lg font-bold mb-3">Partner Quests</h3>

      <div className="grid grid-cols-2 gap-2">
        {quests.map((q) => {
          const locked = q.isLocked;

          return (
            <div
              key={q.id}
              onClick={() => !locked && openPopup(q)}
              style={{ backgroundColor: q.color }}
              className={`relative rounded-xl p-4 h-[180px] flex items-center justify-center ${
                locked ? "cursor-not-allowed opacity-80" : "cursor-pointer"
              }`}
            >
              {/* logo */}
              <Image
                src={q.img}
                alt={q.title}
                className={locked ? "blur-sm" : ""}
              />

              {/* title + reward, blurred only when locked */}
              <div
                className={`absolute bottom-3 left-0 right-0 flex flex-col items-center text-center ${
                  locked ? "blur-sm" : ""
                }`}
              >
                <p className="text-sm font-semibold">{q.title}</p>
                <p className="text-xs mt-1 flex items-center justify-center">
                  <Image
                    src={MinimilesSymbol}
                    alt=""
                    width={12}
                    height={12}
                    className="mr-1"
                  />
                  {q.reward}
                </p>
              </div>

              {/* locked overlay */}
              {locked && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="bg-white/90 rounded-full flex items-center py-1 px-3">
                    <Lock color="#07955F" className="w-4 h-4 mr-1" />
                    <span className="text-sm text-[#07955F] font-semibold">
                      Coming Soon
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