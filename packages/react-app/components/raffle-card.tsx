import Image, { StaticImageData } from "next/image";

type RaffleCardProps = {
  image: StaticImageData;
  title: string;
  endsIn: string;
  ticketCost: string;
  icon: string
};

export const RaffleCard = ({ image, title, endsIn, ticketCost, icon }: RaffleCardProps) => (
  <div className="rounded-xl overflow-hidden bg-white shadow-md min-w-[180px] relative">
    <div className="relative">
      <Image src={image} alt={title} width={180} height={120} className="w-full object-cover" />
      <div className="absolute inset-0 bg-black/30" /> 
    </div>
    <div className="absolute bottom-0 left-0 p-2 w-full">
      <p className="text-sm font-semibold text-white">{title}</p>
      <p className="text-xs text-gray-200">Ends in {endsIn}</p>
      <p className="text-xs text-black font-bold bg-white rounded-full p-1 flex"><Image src={icon} alt="" className="mr-1" />{ticketCost}</p>
    </div>
  </div>
);
