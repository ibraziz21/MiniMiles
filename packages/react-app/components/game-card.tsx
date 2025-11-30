import { Lock } from "@phosphor-icons/react";
import Image, { StaticImageData } from "next/image";

type GameCardProps = {
  name: string;
  date: string;
  image: StaticImageData;
  locked?: boolean; // 👈 new
};

export const GameCard = ({ name, date, image, locked = false }: GameCardProps) => (
  <div className="relative rounded-xl overflow-hidden bg-black max-w-[160px] border-2 border-[#ADF4FF80]">
    <Image
      src={image}
      alt={name}
      width={160}
      height={160}
      className={locked ? "opacity-70 blur-sm" : "opacity-100"}
    />

    {/* Overlay only if locked */}
    {locked && (
      <div className="absolute inset-0 flex flex-col items-center justify-center text-white text-center">
        <div className="bg-white/90 rounded-full flex items-center p-1">
          <Lock size={16} color="#238D9D" weight="bold" className="mr-1" />
          <span className="text-xs text-[#238D9D] font-medium">
            Coming Soon
          </span>
        </div>
      </div>
    )}

    <div className="absolute bottom-0 left-0 p-2">
      <p className="text-md font-medium text-white">{name}</p>
      {/* optional: show date if not "live" */}
      {/* <p className="text-xs text-white/70">{date}</p> */}
    </div>
  </div>
);
