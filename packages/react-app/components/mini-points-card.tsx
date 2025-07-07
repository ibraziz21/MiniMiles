// components/PointsCard.tsx
import { Button } from "@/components/ui/button";
import { akibaMilesSymbolAlt } from "@/lib/svg";
import Image from "next/image";

export default function MiniPointsCard({ points }: { points: number }) {
    return (
        <div className="p-3 mb-4 mx-4 flex flex-col justify-between bg-point-card bg-[#238D9D] bg-no-repeat bg-cover font-sterling rounded-2xl">
            <h3 className="text-white">Total akibaMiles</h3>
            <div className="flex items-center justify-start my-3">
                <Image src={akibaMilesSymbolAlt} width={32} height={32} alt="" />
                <p className="text-3xl font-medium pl-2 text-white">{points.toLocaleString()}</p>
            </div>
        </div>
    );
}
