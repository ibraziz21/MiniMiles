import { Earn, HomeSvg, Ticket } from "@/lib/svg";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from 'next/navigation'

type Props = {
  className?: string;
};


export default function Footer() {
  const pathname = usePathname()

  return (
    <nav className="fixed bottom-0 w-full bg-white border-t flex justify-around items-end font-poppins h-[72px]">
      <Link href="/earn" className={`flex flex-col items-center justify-center text-gray-600 text-xs w-[100px] h-[60px] rounded-t-full ${pathname === "/earn" ? "bg-[#CFF2E5]" : ""}`}>
        <Image src={Earn} alt="" />
        <span className="font-sterling">Earn</span>
      </Link>

      <Link href="/" className={`flex flex-col items-center relative bottom-[10px] border-4 border-white p-6 rounded-full bg-[#07955F] ${pathname === "/" ? "border-[#CFF2E5]" : ""}`}>
        <Image src={HomeSvg} alt="" className="w-[36px] h-[36px]" />
      </Link>

      <Link href="/spend" className={`flex flex-col items-center justify-center text-gray-600 text-xs w-[100px] h-[60px] rounded-t-full ${pathname === "/spend" ? "bg-[#CFF2E5]" : ""}`}>
        <Image src={Ticket} alt="" />
        <span className="font-sterling">Spend</span>
      </Link>
    </nav>
  );
}
