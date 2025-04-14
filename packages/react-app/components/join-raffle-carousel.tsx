import { img } from "@/lib/img";
import { RaffleCard } from "./raffle-card";

export default function JoinRafflesCarousel() {
    const raffles = [
        {
            title: "WIN 500 USDT",
            subtitle: "Ends in 7 days | 10 points per ticket",
            image: "/raffle-500usdt.jpg",
        },
        {
            title: "250 USDC",
            subtitle: "Ends in 7 days | 6 points per ticket",
            image: "/raffle-250usdc.jpg",
        },
    ];

    return (
        <div className="mx-4 mt-6">
            <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold">Join Raffles</h3>
                <span className="text-sm text-green-600">View more ›</span>
            </div>
            <div className="flex gap-3 overflow-x-auto mt-4">
                <RaffleCard
                    image={img.win}
                    title="500 USDT weekly"
                    endsIn="7 days"
                    ticketCost="10 MiniMiles for 1 ticket"
                />
            </div>
        </div>
    );
}
