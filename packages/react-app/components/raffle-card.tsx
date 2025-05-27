import { Lock } from "@phosphor-icons/react";
import Image, { StaticImageData } from "next/image";

// components/raffle-card.tsx

export type RaffleCardProps = {
  image: StaticImageData;
  title: string;
  endsIn: string;
  ticketCost: string;
  icon: StaticImageData;
  onClick?: () => void;
  locked?: boolean;          // ← new, overrides endsIn
};

export const RaffleCard = ({
  image,
  title,
  endsIn,
  ticketCost,
  icon,
  onClick,
  locked = false,            // default false
}: RaffleCardProps) => {
  const isLocked = locked;

  return (
    <div
      onClick={onClick}
      className="rounded-xl bg-white shadow-md min-w-[240px] min-h-[240px] relative cursor-pointer overflow-hidden"
    >
      <div className="relative h-full w-full">
        <Image
          src={image}
          alt={`${title} banner`}
          fill
          className={isLocked ? "object-cover blur-sm" : "object-cover"}
        />
        {isLocked && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="bg-white/90 rounded-full flex items-center p-1">
              <Lock size={16} color="#219653" weight="bold" className="mr-1" />
              <span className="text-xs text-[#07955F] font-semibold">
                Coming Soon
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="absolute bottom-0 left-0 p-2">
        <p className="text-sm font-semibold text-white">{title}</p>
        <p className="text-xs text-gray-200">Ends in {endsIn}</p>
        <p className="text-xs font-bold bg-white rounded-full p-1 mt-1 flex items-center">
          <Image src={icon} alt="" width={12} height={12} className="mr-1" />
          {ticketCost}
        </p>
      </div>
    </div>
  );
};
