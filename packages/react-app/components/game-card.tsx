import { Lock } from "@phosphor-icons/react";
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
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="bg-white/90 rounded-full flex items-center p-1">
          <Lock size={16} color="#219653" weight="bold" className="mr-1" />
          <span className="text-xs text-[#07955F] font-semibold">
            Coming Soon
          </span>
        </div>
      </div>
      <p className="text-sm font-semibold">{name}</p>
    </div>
  </div>
);
