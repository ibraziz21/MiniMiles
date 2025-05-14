import { RaffleImg1, RaffleImg3, WinImg } from "@/lib/img";
import { RaffleCard } from "./raffle-card";
import Link from "next/link";
import { MinimilesSymbol } from "@/lib/svg";
import { useEffect, useState } from "react";

import { fetchActiveRaffles,Raffle } from "@/helpers/raffledisplay";


export default function JoinRafflesCarousel() {
    const [raffles, setRaffles] = useState<Raffle[]>([])
    const [loading, setLoading] = useState(true)
  const [showPopup, setShowPopup] = useState(false);

  useEffect(() => {
    fetchActiveRaffles()
      .then(setRaffles)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div>Loading…</div>

    return (
        <div className="mx-4 mt-6">
            <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold">Join Raffles</h3>
                <Link href='/spend'>
                    <span className="text-sm text-green-600 hover:underline">View more ›</span>
                </Link>
            </div>
            <div className="flex gap-3 overflow-x-auto mt-4">
                {raffles.map((raffle,ind) => {
                    return <RaffleCard
                        key={ind}
                        image={RaffleImg1}
                        title={raffle.rewardToken}
                        endsIn={raffle.ends.toString()}
                        ticketCost="10 MiniMiles for 1 ticket"
                        icon={MinimilesSymbol}
                        setShowPopup={setShowPopup}
                    />
                })}
            </div>
        </div>
    );
}
