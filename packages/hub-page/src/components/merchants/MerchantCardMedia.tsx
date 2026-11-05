"use client";

import { useState } from "react";
import { Coffee, Globe, Monitor, Scissors, ShoppingCart, Store, Utensils } from "lucide-react";

type Props = {
  name: string;
  bannerUrl: string | null;
  logoUrl: string | null;
  category?: string;
  onlineOnly: boolean;
};

export function MerchantCardMedia({ name, bannerUrl, logoUrl, category = "", onlineOnly }: Props) {
  const [failed, setFailed] = useState<string[]>([]);
  const banner = bannerUrl && !failed.includes(bannerUrl) ? bannerUrl : null;
  const logo = logoUrl && !failed.includes(logoUrl) ? logoUrl : null;
  const image = banner ?? logo;
  const monogram = onlineOnly ? null : name.trim().match(/[\p{L}\p{N}]/u)?.[0].toLocaleUpperCase();
  const CategoryIcon = /coffee|cafe|bakery/.test(category) ? Coffee
    : /food|dining|restaurant/.test(category) ? Utensils
    : /grocer|supermarket/.test(category) ? ShoppingCart
    : /salon|beauty|barber/.test(category) ? Scissors
    : /electronic|tech/.test(category) ? Monitor
    : onlineOnly ? Globe : Store;

  return (
    <div aria-hidden="true" className="relative grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-[#F2F3FF]">
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" loading="lazy" onError={() => setFailed((current) => [...current, image])}
          className={banner ? "absolute inset-0 h-full w-full object-cover" : "h-full w-full object-contain"} />
      ) : monogram ? (
        <span className="grid h-full w-full place-items-center bg-[#0F5132] text-3xl font-bold text-white">{monogram}</span>
      ) : (
        <CategoryIcon className="h-10 w-10 text-[#0F5132]" />
      )}
      {banner && (
        <span className="absolute bottom-1 right-1 grid h-4 w-4 place-items-center rounded-full bg-white text-[#006C49]">
          <CategoryIcon className="h-3 w-3" />
        </span>
      )}
    </div>
  );
}
