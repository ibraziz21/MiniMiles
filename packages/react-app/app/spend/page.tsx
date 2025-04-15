import { GameCard } from '@/components/game-card'
import { Hero } from '@/components/Hero'
import { RaffleCard } from '@/components/raffle-card'
import { SectionHeading } from '@/components/section-heading'
import { img } from '@/lib/img'
import React from 'react'

const page = () => {
    return (
        <main className="pb-24 font-poppins">
            <Hero />

            <SectionHeading title="Join digital cash raffles" />
            <div className="flex space-x-3 overflow-x-auto px-4 whitespace-nowrap scrollbar-hide">
                <RaffleCard
                    image={img.win}
                    title="500 USDT weekly"
                    endsIn="7 days"
                    ticketCost="10 MiniMiles for 1 ticket"
                />
                <RaffleCard
                    image={img.win}
                    title="250 USDT"
                    endsIn="7 days"
                    ticketCost="6 points for 1 ticket"
                />
                <RaffleCard
                    image={img.win}
                    title="500 USDT weekly"
                    endsIn="7 days"
                    ticketCost="10 MiniMiles for 1 ticket"
                />
                <RaffleCard
                    image={img.win}
                    title="250 USDT"
                    endsIn="7 days"
                    ticketCost="6 points for 1 ticket"
                />
                <RaffleCard
                    image={img.win}
                    title="500 USDT weekly"
                    endsIn="7 days"
                    ticketCost="10 MiniMiles for 1 ticket"
                />
                <RaffleCard
                    image={img.win}
                    title="250 USDT"
                    endsIn="7 days"
                    ticketCost="6 points for 1 ticket"
                />
                <RaffleCard
                    image={img.win}
                    title="500 USDT weekly"
                    endsIn="7 days"
                    ticketCost="10 MiniMiles for 1 ticket"
                />
                <RaffleCard
                    image={img.win}
                    title="250 USDT"
                    endsIn="7 days"
                    ticketCost="6 points for 1 ticket"
                />
            </div>

            <SectionHeading title="Join physical goods raffles" />
            <div className="flex space-x-3 overflow-x-auto px-4">
                <RaffleCard
                    image={img.win}
                    title="Ledger hardware wallet"
                    endsIn="5 days"
                    ticketCost="3 MiniMiles for 1 ticket"
                />
                <RaffleCard
                    image={img.win}
                    title="Laptop"
                    endsIn="4 days"
                    ticketCost="50 tickets by brand"
                />
            </div>

            <SectionHeading title="Join NFT Raffles" />
            <div className="flex space-x-3 overflow-x-auto px-4">
                <RaffleCard
                    image={img.win}
                    title="BoredApe #567"
                    endsIn="3 days"
                    ticketCost="10 MiniMiles for 1 ticket"
                />
                <RaffleCard
                    image={img.win}
                    title="CryptoPunk #789"
                    endsIn="2 days"
                    ticketCost="12 MiniMiles"
                />
            </div>

            <SectionHeading title="Upcoming games" />
            <div className="flex space-x-3 overflow-x-auto px-4">
                <GameCard
                    name="Dice"
                    date="xx/xx/xx"
                    image="/dice.jpg"
                />
                <GameCard
                    name="Coin flip"
                    date="xx/xx/xx"
                    image="/coin.jpg"
                />
            </div>
        </main>
    )
}

export default page