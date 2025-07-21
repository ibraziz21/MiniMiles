// components/raffle-result-card.tsx
import { Trophy } from "@phosphor-icons/react";
import Image, { StaticImageData } from "next/image";
import dayjs from "dayjs";

export interface RaffleResultCardProps {
  /** Banner or token image */
  image: StaticImageData | string;
  /** Raffle round id (e.g. 24) */
  roundId: string | number;
  /** Unix timestamp (seconds) when result was posted */
  ts: number;
  /** Truncated or full winner address */
  winner: string;
  /** Human‑readable prize label, e.g. “500 USDT” */
  prize: string;

}

export const RaffleResultCard: React.FC<RaffleResultCardProps> = ({
  image,
  roundId,
  ts,
  winner,
  prize,

}) => (
  <div
    className="rounded-xl bg-white shadow-md min-w-[240px] min-h-[240px] relative overflow-hidden cursor-pointer"
  >
    {/* banner */}
    <Image
      src={image}
      alt={`Raffle ${roundId} banner`}
      fill
      className="object-cover"
    />

    {/* translucent gradient bottom overlay */}
    <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 to-black/10" />

    {/* content */}
    <div className="absolute bottom-0 left-0 w-full p-3 text-white">
      {/* header row */}
      <div className="flex items-center justify-between text-sm font-medium">
        <span>Raffle #{roundId}</span>
        <span className="flex items-center gap-1">
          <Trophy size={14} weight="fill" />
          {prize}
        </span>
      </div>

      {/* sub‑line */}
      <div className="mt-1 text-xs text-gray-200">
        Winner:&nbsp;{winner}
      </div>

      {/* date */}
      <div className="text-[10px] text-gray-300">
        {dayjs.unix(ts).format("DD MMM YY")}
      </div>
    </div>
  </div>
);
