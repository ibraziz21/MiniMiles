// components/PointsCard.tsx
import { Button } from "@/components/ui/button";
import { Earn, akibaMilesSymbolAlt, Ticket, TicketAlt, Transcript } from "@/lib/svg";
import Image from "next/image";
import Link from "next/link";

export default function PointsCard({ points }: { points: number }) {
    return (
        <div className="bg-point-card bg-[#238D9D] bg-no-repeat bg-contain  text-white rounded-2xl pt-4 px-2 mx-4 mt-4 space-y-4">
            <div className="p-3 flex flex-col justify-between">
                <h3 className="">Total AkibaMiles</h3>
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
