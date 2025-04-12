import { Lock } from "lucide-react";
import Image from "next/image";

type GameCardProps = {
  name: string;
  date: string;
  image: string;
};

export const GameCard = ({ name, date, image }: GameCardProps) => (
  <div className="relative rounded-xl overflow-hidden bg-black max-w-[160px]">
    <Image src={image} alt={name} width={160} height={120} className="opacity-70" />
    <div className="absolute inset-0 flex flex-col items-center justify-center text-white text-center">
      <Lock className="w-4 h-4 mb-1" />
      <p className="text-sm font-semibold">{name}</p>
      <p className="text-xs">Live on {date}</p>
    </div>
  </div>
);
