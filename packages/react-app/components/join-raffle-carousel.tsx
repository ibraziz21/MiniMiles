import { RaffleImg1, RaffleImg3, WinImg } from "@/lib/img";
import { RaffleCard } from "./raffle-card";
import Link from "next/link";
import { akibaMilesSymbol } from "@/lib/svg";
import { useEffect, useState } from "react";

import { fetchActiveRaffles,TokenRaffle } from "@/helpers/raffledisplay";


export default function JoinRafflesCarousel() {
    const [raffles, setRaffles] = useState<TokenRaffle[]>([])
    const [loading, setLoading] = useState(true)
  const [showPopup, setShowPopup] = useState(false);

  useEffect(() => {
    fetchActiveRaffles()
      .then(({ tokenRaffles }) => setRaffles(tokenRaffles))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div>Loading…</div>

    return (
        <div className="mx-4 mt-6">
            <div className="flex justify-between items-center">
                <h3 className="text-lg font-medium">Join Raffles</h3>
                <Link href='/spend'>
                    <span className="text-sm text-[#238D9D] hover:underline">View more ›</span>
                </Link>
            </div>
            <div className="flex gap-3 overflow-x-auto mt-4">
                {raffles.map((raffle,ind) => {
                    return <RaffleCard
                        key={ind}
                        image={RaffleImg1}
                        title={raffle.token.symbol}
                        endsIn={raffle.ends.toString()}
                        ticketCost="10 akibaMiles for 1 ticket"
                        icon={akibaMilesSymbol}
                    />
                })}
            </div>
        </div>
    );
}
