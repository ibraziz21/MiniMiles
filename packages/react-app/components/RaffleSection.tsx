// components/RaffleSection.tsx
import React from 'react'
import { MinimilesSymbol } from '@/lib/svg'
import { RaffleCard } from './raffle-card'
import { StaticImageData } from 'next/image'

interface RaffleItem {
  image: StaticImageData
  title: string
  endsIn: string
  ticketCost: string
  symbol?: string
  onClick: () => void
}

interface RaffleSectionProps {
  title: string
  items: RaffleItem[]
}

export function RaffleSection({ title, items }: RaffleSectionProps) {
  return (
    <div className="mx-4 mt-6">
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <div className="flex space-x-4 overflow-x-auto py-2">
        {items.map((item, i) => (
          <div
            key={i}
            className="flex-shrink-0 min-w-[200px] h-[260px] p-2"
          >
            <RaffleCard
              image={item.image}
              title={item.title}
              endsIn={item.endsIn}
              ticketCost={item.ticketCost}
              icon={MinimilesSymbol}
              onClick={item.onClick}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
