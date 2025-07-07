// components/PointsCard.tsx
import { Button } from "@/components/ui/button";
import { akibaMilesSymbolAlt } from "@/lib/svg";
import Image from "next/image";

type Props = {
    title: string;
    stats: string;
}

export default function HistoryStats({ title, stats }: Props) {
    return (
        <div className="p-3 mb-4 mx-4 flex flex-col justify-between border border-[#07955F4D] font-sterling rounded-3xl bg-white">
            <h3 className="text-gray-500 font-light text-xl">{title}</h3>
            <div className="flex items-center justify-start my-3">
                <p className="text-3xl font-medium pl-2 text-black">{stats}</p>
            </div>
        </div>
    );
}
