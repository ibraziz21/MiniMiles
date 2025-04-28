import { WinImg } from "@/lib/img";
import { RaffleCard } from "./raffle-card";
import Link from "next/link";
import { MinimilesSymbol } from "@/lib/svg";


export default function JoinRafflesCarousel() {
    const raffles = [
        {
            title: "WIN 500 USDT",
            subtitle: "Ends in 7 days",
            image: WinImg,
            ticketcost: "5 MiniMiles for 1 ticket"
        },
        {
            title: "250 USDC",
            subtitle: "Ends in 7 days",
            image: WinImg,
            ticketcost: "6 Minimiles for 2 ticket"
        },
    ];

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
                        image={raffle.image}
                        title={raffle.title}
                        endsIn={raffle.subtitle}
                        ticketCost="10 MiniMiles for 1 ticket"
                        icon={MinimilesSymbol}
                    />
                })}
            </div>
        </div>
    );
}
