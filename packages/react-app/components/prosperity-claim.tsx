// src/components/ProsperityPassCard.tsx
'use client';

import type { FC } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import v162 from '@/public/svg/v162.svg';
import ppBadge from '@/public/svg/pass-icon.svg';

type ProsperityPassCardProps = {
  onClaim?: () => void;
  disabled?: boolean;
};

export const ProsperityPassCard: FC<ProsperityPassCardProps> = ({
  onClaim,
  disabled,
}) => {
  return (
    <div
      className="
        relative
        mx-4 mt-4             /* match PointsCard horizontal + top margin */
        flex
        w-auto                 /* take available width inside mx-4 */
        flex-col
        items-center
        justify-between
        gap-4
        rounded-[16px]
        bg-[#F0FDFF]
        p-4
        shadow-[0_6px_8px_0_rgba(0,0,0,0.15)]
        overflow-hidden
      "
    >
      {/* Background streak (Vector 162) */}
      <Image
        src={v162}
        alt=""
        aria-hidden="true"
        className="
          pointer-events-none
          select-none
          absolute
          -right-[72px]
          -top-[40px]
          h-[310px]
          w-[336px]
        "
      />

      {/* Main text card */}
      <div
        className="
          relative
          z-10
          w-full              /* fill the outer card, like PointsCard inner blocks */
          rounded-[16px]
          bg-white/80
          px-4
          pt-5
          pb-5
          flex
          flex-col
        "
      >
        {/* Badge icon on top */}
        <Image
          src={ppBadge}
          alt="Prosperity Pass badge"
          width={32}
          height={24}
          className="mb-3 h-6 w-8"
        />

        {/* Text starts below the badge */}
        <p className="text-base leading-relaxed text-[#111827]">
          Claim your Prosperity Pass to start unlocking badges and become
          eligible for future Celo rewards.
        </p>
      </div>

      {/* Button wrap (full width, like PointsCard CTAs) */}
      <div className="relative z-10 mt-1 h-[56px] w-full">
        <Button
          type="button"
          title="Claim Pass"
          className="
            flex
            h-full
            w-full
            items-center
            justify-center
            gap-2
            rounded-[16px]
            bg-[#238D9D]
            text-base
            font-semibold
            text-white
            hover:bg-[#1d7581]
          "
          disabled={disabled}
          onClick={onClaim}
        />
      </div>
    </div>
  );
};
