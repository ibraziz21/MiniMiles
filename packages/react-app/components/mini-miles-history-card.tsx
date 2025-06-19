// components/PointsCard.tsx
import { Button } from "@/components/ui/button";
import { MinimilesSymbolAlt } from "@/lib/svg";
import Image from "next/image";

export default function MiniMilesHistoryCard({ points }: { points: number }) {
    return (
        <div className="p-3 mb-4 mx-4 flex flex-col justify-between bg-point-card bg-[#219653] bg-no-repeat bg-cover font-sterling rounded-2xl">
            <h3 className="text-white font-light text-xl">Total MiniMiles earned overtime</h3>
            <div className="flex items-center justify-center my-3">
                <Image src={MinimilesSymbolAlt} width={32} height={32} alt="" />
                <p className="text-3xl font-medium pl-2 text-white">{points.toLocaleString()}</p>
            </div>
        </div>
    );
}
