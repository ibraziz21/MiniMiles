// components/campaign-hero.tsx
"use client";

import Image, { StaticImageData } from "next/image";
import { Trophy } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";

export type CampaignHeroProps = {
  /** Prize / campaign title */
  title: string;
  /** Prize artwork shown as the backdrop */
  image: StaticImageData | string;
  /** Formatted "ends in" label, e.g. "2d" or "5h 12m" */
  endsIn: string;
  /** Short ticket-cost label, e.g. "20/ticket" */
  ticketCost: string;
  /** Number of winners, if known */
  winners?: number;
  /** AkibaMiles symbol icon */
  icon: StaticImageData | string;
  /** Opens the raffle entry sheet */
  onEnter: () => void;
};

/**
 * Full-width landing hero promoting the single active campaign raffle.
 * This is the primary call-to-action on the home page — one clear "Enter Raffle".
 */
export const CampaignHero = ({
  title,
  image,
  endsIn,
  ticketCost,
  winners,
  icon,
  onEnter,
}: CampaignHeroProps) => {
  return (
    <section className="mx-4 mt-4">
      <div className="relative min-h-[208px] overflow-hidden rounded-2xl shadow-lg">
        {/* Prize backdrop */}
        <Image src={image} alt="" fill priority className="object-cover" />

        {/* Legibility overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/10" />

        <div className="relative flex min-h-[208px] flex-col justify-end p-4">
          <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-[#238D9D] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
            <span className="h-1.5 w-1.5 rounded-full bg-white" />
            Live raffle
          </span>

          <h2 className="mt-2 text-2xl font-extrabold leading-tight text-white">
            {title}
          </h2>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-white/90">
            <span>Ends in {endsIn}</span>
            <span className="inline-flex items-center gap-1">
              <Image src={icon} alt="" width={14} height={14} />
              {ticketCost}
            </span>
            {typeof winners === "number" && winners > 0 && (
              <span className="inline-flex items-center gap-1">
                <Trophy size={13} weight="fill" />
                {winners} winner{winners === 1 ? "" : "s"}
              </span>
            )}
          </div>

          <Button
            title="Enter Raffle"
            onClick={onEnter}
            widthFull
            className="mt-3 h-12 bg-white text-base font-bold text-[#238D9D] shadow-md hover:bg-white"
          />
        </div>
      </div>
    </section>
  );
};
