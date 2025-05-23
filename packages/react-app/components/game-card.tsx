import { Lock } from "lucide-react";
import Image, { StaticImageData } from "next/image";

type GameCardProps = {
  name: string;
  date: string;
  image: StaticImageData;
};

export const GameCard = ({ name, date, image }: GameCardProps) => (
  <div className="relative rounded-xl overflow-hidden bg-black max-w-[160px]">
    <Image src={image} alt={name} width={160} height={120} className="opacity-70 blur-sm" />
    <div className="absolute inset-0 flex flex-col items-center justify-center text-white text-center">
      <div className="bg-white rounded-full flex items-center py-1 px-3">
        <Lock color="#07955F" className="w-4 h-4 mb-1 ml-2" />
        <h4 className="text-[#07955F] text-sm">Coming Soon</h4>
      </div>
      <p className="text-sm font-semibold">{name}</p>
    </div>
  </div>
);
