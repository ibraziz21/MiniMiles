import { Cash, Celo, Door, GloDollar, Mento, MinimilesSymbol, MiniPay } from "@/lib/svg";
import Image from "next/image";
import Link from "next/link";
// components/DailyChallenges.tsx
const quests = [
  {
    img: Celo,
    title: "Celo",
    description: "Send a daily MiniPay payment (above $5)",
    reward: "5 MiniMiles",
    color:"#FFFFD6"
  },
  {
    img: MiniPay,
    title: "MiniPay",
    description: "Open MiniMiles today",
    reward: "10 MiniMiles",
    color: "#B2DEC4"
  },
  {
    img: GloDollar,
    title: "GLO Dollar",
    description: "Send a daily MiniPay payment (above $5)",
    reward: "5 MiniMiles",
    color: "#24E5E033"
  },
  {
    img: Mento,
    title: "Mento",
    description: "Open MiniMiles today",
    reward: "10 MiniMiles",
    color: "#07955F1A"
  },
];

export default function PartnerQuests({openPopup}:any) {
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
          <div onClick={()=> openPopup()} key={index} style={{backgroundColor: quest.color}} className={` border border-[#07955F4D] rounded-xl p-4  h-[200px]`}>
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