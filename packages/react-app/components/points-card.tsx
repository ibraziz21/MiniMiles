// components/PointsCard.tsx
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function PointsCard({ points }: { points: number }) {
    return (
        <div className="bg-gray-100 rounded-xl p-4 mx-4 mt-4 space-y-4">
            <div className="">
                <h3 className="text-sm text-gray-600">Total Points</h3>
                <p className="text-3xl font-semibold">{points.toLocaleString()}</p>
            </div>
            <div className="flex gap-2 justify-center items-center">
                <Link href="/earn">
                    <Button title="Earn points" onClick={() => { }} variant="outline" className="flex-1 bg-green-100 text-green-700 hover:text-green-700"></Button>
                </Link>
                <Link href="">
                    <Button title="Spend points" onClick={() => { }} className="flex-1 bg-green-600 hover:bg-green-700 text-white"></Button></Link>
            </div>
            <Button title="View my history" onClick={() => { }} variant="ghost" className="w-full bg-white border text-black hover:bg-white hover:text-black">

            </Button>
        </div>
    );
}
