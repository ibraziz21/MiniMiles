// components/PointsCard.tsx
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function PointsCard({ points }: { points: number }) {
    return (
        <div className="bg-point-card bg-[#219653] bg-no-repeat bg-cover text-white rounded-t-xl pt-4 px-2 mx-4 mt-4 space-y-4">
            <div className="">
                <h3 className="">Total MiniMiles</h3>
                <p className="text-3xl font-semibold">{points.toLocaleString()}</p>
            </div>
            <div className="bg-white p-5 rounded-xl">
                <div className="flex gap-2 justify-around items-center w-full py-2">
                    <Link href="/earn" className="w-full">
                        <Button title="Earn" onClick={() => { }} variant="outline" className="flex-1 bg-white font-bold text-primarygreen hover:text-primarygreen rounded-md w-full"></Button>
                    </Link>
                    <Link href="" className="w-full">
                        <Button title="Spend points" onClick={() => { }} className="flex-1 bg-primarygreen hover:bg-primarygreen text-white rounded-md w-full"></Button></Link>
                </div>
                <Button title="View history" onClick={() => { }} variant="ghost" className="w-full bg-white border text-primarygreen hover:bg-white hover:text-primarygreen font-bold">

                </Button>
            </div>
        </div>
    );
}
