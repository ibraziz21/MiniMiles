import { Cash, Door, MinimilesSymbol } from "@/lib/svg";
import Image from "next/image";
import Link from "next/link";
// components/DailyChallenges.tsx
const challenges = [
  {
    img: Cash,
    title: "First payment",
    description: "Send a daily MiniPay payment (above $5)",
    reward: "5 MiniMiles",
  },
  {
    img: Door,
    title: "Open MiniMiles",
    description: "Open MiniMiles today",
    reward: "10 MiniMiles",
  },
  {
    img: Cash,
    title: "First payment",
    description: "Send a daily MiniPay payment (above $5)",
    reward: "5 MiniMiles",
  },
  {
    img: Door,
    title: "Open MiniMiles",
    description: "Open MiniMiles today",
    reward: "10 MiniMiles",
  },
  {
    img: Cash,
    title: "First payment",
    description: "Send a daily MiniPay payment (above $5)",
    reward: "5 MiniMiles",
  },
  {
    img: Door,
    title: "Open MiniMiles",
    description: "Open MiniMiles today",
    reward: "10 MiniMiles",
  },
];

export default function DailyChallenges() {
  return (
    <div className="mx-4 mt-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-bold">Daily challenges</h3>
        <Link href='/earn'>
          <span className="text-sm text-green-600 hover:underline font-bold">See all ›</span>
        </Link>
      </div>
      <div className="flex space-x-3 overflow-x-auto mt-4">
        {challenges.map((challenge, index) => (
          <div key={index} className="bg-white border border-[#07955F4D] rounded-xl p-4 min-w-[150px] h-[234px]">
            <div className="text-center flex flex-col justify-around w-full h-full items-center">
              <Image src={challenge.img} alt="" />
              <p className="text-sm font-semibold">{challenge.title}</p>
              <p className="text-xs text-gray-600 mt-2">{challenge.description}</p>
              <p className="text-xs text-black mt-3 flex justify-center"><Image src={MinimilesSymbol} alt="" className="mr-2" /> {challenge.reward}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
