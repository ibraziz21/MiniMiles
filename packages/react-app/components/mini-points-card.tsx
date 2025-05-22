// components/PointsCard.tsx
import { Button } from "@/components/ui/button";
import { MinimilesSymbolAlt } from "@/lib/svg";
import Image from "next/image";

export default function MiniPointsCard({ points }: { points: number }) {
    return (
        <div className="p-3 my-4 flex flex-col justify-between bg-point-card bg-[#219653] bg-no-repeat bg-cover font-poppins rounded-2xl">
            <h3 className="text-white">Total MiniMiles</h3>
            <div className="flex items-center justify-start my-3">
                <Image src={MinimilesSymbolAlt} width={32} height={32} alt="" />
                <p className="text-3xl font-bold pl-2 text-white">{points.toLocaleString()}</p>
            </div>
        </div>
    );
}
