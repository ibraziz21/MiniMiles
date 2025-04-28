// components/PointsCard.tsx
import { Button } from "@/components/ui/button";
import { MinimilesSymbolAlt } from "@/lib/svg";
import Image from "next/image";
import Link from "next/link";

export default function PointsCard({ points }: { points: number }) {
    return (
        <div className="bg-point-card bg-[#219653] bg-no-repeat bg-cover text-white rounded-2xl pt-4 px-2 mx-4 mt-4 space-y-4">
            <div className="p-3 flex flex-col justify-between">
                <h3 className="">Total MiniMiles</h3>
                <div className="flex items-center justify-start my-3">
                    <Image src={MinimilesSymbolAlt} width={32} height={32} alt="" />
                    <p className="text-3xl font-bold pl-2">{points.toLocaleString()}</p>
                </div>
                <h4 className="text-sm">1 MiniMiles per $ 1.00 spent. *</h4>
            </div>
            <div className="bg-white p-5 rounded-t-xl">
                <div className="flex gap-2 justify-around items-center w-full py-2">
                    <Link href="/earn" className="w-full">
                        <Button title="Earn" onClick={() => { }} variant="outline" className="flex-1 bg-white font-bold text-primarygreen hover:text-primarygreen rounded-xl w-full h-[50px]"></Button>
                    </Link>
                    <Link href="" className="w-full">
                        <Button title="Spend" onClick={() => { }} className="flex-1 bg-primarygreen hover:bg-primarygreen text-white rounded-xl w-full h-[50px]"></Button></Link>
                </div>
                <Button title="View history" onClick={() => { }} variant="ghost" className="w-full bg-white border text-primarygreen hover:bg-white hover:text-primarygreen font-bold">

                </Button>
            </div>
        </div>
    );
}
