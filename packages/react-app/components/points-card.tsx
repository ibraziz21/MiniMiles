// components/PointsCard.tsx
"use client";

import { useState } from "react";
import { Earn, akibaMilesSymbolAlt, TicketAlt, Transcript } from "@/lib/svg";
import { Info, X } from "@phosphor-icons/react";
import Image from "next/image";
import Link from "next/link";

export default function PointsCard({ points }: { points: number }) {
    const [infoOpen, setInfoOpen] = useState(false);

    return (
        <div className="bg-point-card bg-[#238D9D] bg-no-repeat bg-contain  text-white rounded-2xl pt-4 px-2 mx-4 mt-4 space-y-4">
            <div className="p-3 flex flex-col justify-between">
                <div className="relative flex items-center gap-1.5">
                    <h3 className="">Total AkibaMiles</h3>
                    <button
                        type="button"
                        aria-label="How to join rewards"
                        onClick={() => setInfoOpen((v) => !v)}
                        className="text-white/80 active:scale-95"
                    >
                        <Info size={16} weight="bold" />
                    </button>

                    {infoOpen && (
                        <div className="absolute left-0 top-7 z-20 w-64 rounded-xl bg-white p-3 text-left shadow-xl">
                            <div className="flex items-start justify-between gap-2">
                                <p className="text-xs font-semibold text-[#238D9D]">
                                    How to join rewards
                                </p>
                                <button
                                    type="button"
                                    aria-label="Close"
                                    onClick={() => setInfoOpen(false)}
                                >
                                    <X size={14} className="text-gray-400" />
                                </button>
                            </div>
                            <p className="mt-1 text-xs leading-4 text-gray-600">
                                Earn AkibaMiles from daily check-ins and challenges, then spend
                                them on raffle tickets for a chance to win cash and prizes.
                            </p>
                            <Link
                                href="/earn"
                                onClick={() => setInfoOpen(false)}
                                className="mt-2 inline-block text-xs font-semibold text-[#238D9D]"
                            >
                                Earn Miles ›
                            </Link>
                        </div>
                    )}
                </div>
                <div className="flex items-center justify-start my-3">
                    <Image src={akibaMilesSymbolAlt} width={32} height={32} alt="" />
                    <p className="text-3xl font-medium pl-2">{points.toLocaleString()}</p>
                </div>
            </div>
            <div className="bg-white p-5 rounded-t-xl">
                <div className="flex gap-2 justify-around items-center w-full py-2">
                    <Link href="/earn" className="p-3 rounded-xl flex items-center justify-center w-full gap-3 font-medium tracking-wide shadow-sm text-[#238D9D] bg-[#238D9D1A] hover:bg-[#238D9D1A] disabled:bg-[#238D9D]">
                        <Image src={Earn} alt="" /> <h3>Earn</h3>
                    </Link>
                    <Link href="/spend" className="p-3 rounded-xl flex items-center justify-center w-full gap-3 font-medium tracking-wide shadow-sm text-[#238D9D] bg-[#238D9D] hover:bg-[#238D9D] disabled:bg-[#238D9D]">
                        <Image src={TicketAlt} alt="" />  <h3 className="text-white">Spend</h3></Link>
                </div>
                <Link href="/history" className="p-3 rounded-xl flex items-center justify-center w-full gap-3 font-medium tracking-wide shadow-sm text-[#238D9D] ">
                    <Image src={Transcript} alt="" />  <h3>View History</h3></Link>
            </div>
        </div>
    );
}
