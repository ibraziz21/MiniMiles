// components/PointsCard.tsx
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function MiniPointsCard({ points }: { points: number }) {
    return (
        <div className="bg-point-card bg-[#219653] bg-no-repeat bg-cover text-white rounded-3xl py-4 px-2 mx-4 my-4 space-y-4">
            <div className="">
                <h3 className="">Total MiniMiles</h3>
                <p className="text-3xl font-semibold my-3">{points.toLocaleString()}</p>
                <h5>1 MiniMiles per $ 1.00 spent. *</h5>
            </div>
        </div>
    );
}
