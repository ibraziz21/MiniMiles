import Image, { StaticImageData } from "next/image";

export type RaffleCardProps = {
  image: StaticImageData;
  title: string;
  endsIn: string;
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
      <Image src={image} alt={`${title} banner`} fill className="object-cover" />
      <div className="absolute inset-0 bg-black/30" />
    </div>

    <div className="absolute bottom-0 left-0 p-2 w-full">
      <p className="text-sm font-semibold text-white">{title}</p>
      <p className="text-xs text-gray-200">Ends in {endsIn}</p>
      <p className="text-xs font-bold bg-white rounded-full p-1 mt-1 flex items-center">
        <Image src={icon} alt="" width={12} height={12} className="mr-1" />
        {ticketCost}
      </p>
    </div>
  </div>
);
