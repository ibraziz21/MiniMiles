"use client";

// Homepage hero banner — replaces CrackPotLaunchBanner in the !featuredRaffle
// slot (spec §2b). Campaign-driven: merchant + tiers come from
// /api/games/weekly-campaign, never hard-coded. Falls back to a generic
// Akiba Pass banner when no campaign is active.
//
// CTA → /akiba-pass onboarding: a 4-slide carousel (same pattern as the
// Prosperity Pass flow) that DESCRIBES the Akiba Pass — personal QR code,
// 1 Mile per 100 KES at partner shops, spend Miles on deals — before sending
// the user to pass.akibamiles.com. src=home_banner tags attribution through
// the final CTA.

import Link from "next/link";
import Image from "next/image";
import { QrCode, Trophy, ArrowRight } from "@phosphor-icons/react";
import { useWeeklyCampaign } from "@/hooks/games/useWeeklyCampaign";

export function AkibaPassCampaignBanner({ onTap }: { onTap?: () => void } = {}) {
  const { campaign } = useWeeklyCampaign();
  const merchant = campaign?.merchant ?? null;

  const href = "/akiba-pass?src=home_banner";

  const inner = (
    <div className="relative min-h-[200px] overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_82%_18%,rgba(45,169,184,0.38),transparent_32%),linear-gradient(135deg,#062329,#0B5661_56%,#0D2B30)]" />
      <div className="absolute -right-8 top-5 h-32 w-32 rounded-full border border-white/10 bg-white/5" />

      {merchant?.imageUrl && (
        <div className="absolute right-4 top-6 h-16 w-16 overflow-hidden rounded-2xl border border-white/15 bg-white/10 backdrop-blur">
          <Image src={merchant.imageUrl} alt={merchant.name} fill className="object-cover" />
        </div>
      )}

      <div className="relative flex min-h-[200px] flex-col justify-end p-4">
        <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-[#83E8F2]/15 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-[#D9FCFF] ring-1 ring-[#83E8F2]/25">
          <span className="h-1.5 w-1.5 rounded-full bg-[#83E8F2]" />
          Akiba Pass
        </span>

        <h2 className="mt-2 max-w-[250px] text-2xl font-extrabold leading-tight text-white">
          Your Miles now work in real shops
        </h2>

        <p className="mt-1.5 max-w-[290px] text-[13px] leading-snug text-white/80 font-poppins">
          {merchant
            ? `One QR scan at the till and you're earning — starting with ${merchant.name}. 1 Mile per 100 KES.`
            : "The Akiba Pass is your personal QR code — one scan at the till and you're earning 1 Mile per 100 KES."}
        </p>

        {merchant && campaign && campaign.tiers.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold">
            <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-white ring-1 ring-white/15">
              <Trophy size={11} weight="fill" className="text-amber-300" />
              Top 3 win vouchers
            </span>
            {campaign.tiers.slice(0, 3).map((t) => (
              <span key={t.rank} className="rounded-full bg-white/10 px-2.5 py-1 text-white ring-1 ring-white/15">
                {t.label}
              </span>
            ))}
          </div>
        )}

        <span className="mt-3 inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-white px-4 text-sm font-extrabold text-[#0B5661] shadow-md">
          <QrCode size={16} weight="fill" />
          Get my Akiba Pass
          <ArrowRight size={14} weight="bold" />
        </span>
      </div>
    </div>
  );

  return (
    <section className="mx-4 mt-4">
      <Link
        href={href}
        onClick={onTap}
        className="group block overflow-hidden rounded-2xl bg-[#062329] shadow-lg transition-transform active:scale-[0.99]"
        aria-label="Get your Akiba Pass"
      >
        {inner}
      </Link>
    </section>
  );
}
