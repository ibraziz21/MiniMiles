import Link from "next/link";
// components/DailyChallenges.tsx
const challenges = [
    {
      title: "Spend 5 USDT",
      description: "Spend 5 USDT from your MiniPay wallet daily.",
      reward: "2 MiniMiles",
    },
    {
      title: "Refer a friend",
      description: "Refer a friend and get them to use MiniMiles app and earn.",
      reward: "10 MiniMiles",
    },
  ];
  
  export default function DailyChallenges() {
    return (
      <div className="mx-4 mt-6">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-semibold">Daily challenges</h3>
          <Link href='/earn'>
          <span className="text-sm text-green-600 hover:underline">View more ›</span>
          </Link>
        </div>
        <div className="flex gap-3 overflow-x-auto mt-4">
          {challenges.map((challenge, index) => (
            <div key={index} className="bg-green-100 rounded-xl p-4 min-w-[160px] flex-shrink-0">
              <div className="text-center">
                <p className="text-sm font-semibold">{challenge.title}</p>
                <p className="text-xs text-gray-600 mt-2">{challenge.description}</p>
                <p className="text-xs text-green-800 mt-3">{challenge.reward}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  