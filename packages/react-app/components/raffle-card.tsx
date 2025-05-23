import { Lock } from "@phosphor-icons/react";
import Image, { StaticImageData } from "next/image";

export type RaffleCardProps = {
  image: StaticImageData;
  title: string;
  endsIn: number;
  ticketCost: string;
  icon: StaticImageData;
  onClick?: () => void;          // (optional) click handler
};

export const RaffleCard = ({
  image,
  title,
  endsIn,
  ticketCost,
  icon,
  onClick,
}: RaffleCardProps) => (
  <div
    onClick={onClick}
    className="rounded-xl bg-white shadow-md min-w-[240px] min-h-[240px] relative cursor-pointer overflow-hidden"
  >
    <div className="relative h-full w-full">
      <Image src={image} alt={`${title} banner`} fill className={`object-cover ${endsIn > 4 ? "blur-sm" : null}`} />
      <div className="absolute inset-0 flex flex-col items-center justify-center text-white text-center">
        {endsIn > 4 ? <div className="bg-white rounded-full flex items-center py-1 px-3">
          <Lock color="#07955F" className="w-4 h-4 mb-1 ml-2" />
          <h4 className="text-[#07955F] text-sm">Coming Soon</h4>
        </div> : null}
      </div>
      <div className="absolute inset-0" />
    </div>

    <div className="absolute bottom-0 left-0 p-2 w-full">
      <p className="text-sm font-semibold text-white">{title}</p>
      <p className="text-xs text-gray-200">Ends in {endsIn} Days</p>
      <p className="text-xs font-bold bg-white rounded-full p-1 mt-1 flex items-center">
        <Image src={icon} alt="" width={12} height={12} className="mr-1" />
        {ticketCost}
      </p>
    </div>
  </div>
);
