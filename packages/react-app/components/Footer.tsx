import { Earn, HomeSvg, Spend } from "@/lib/svg";
import { Gamepad2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from 'next/navigation'

export default function Footer() {
  const pathname = usePathname()

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  const gamesActive = isActive("/games") || isActive("/dice") || isActive("/claw") || isActive("/crackpot") || isActive("/games/skill") || isActive("/games/farkle");

  return (
    <nav className="fixed bottom-0 w-full bg-white border-t flex justify-around items-end font-poppins h-[72px]">
      <Link href="/" className={`flex flex-col items-center justify-center text-xs w-[80px] h-[60px] rounded-t-full gap-0.5 ${isActive("/") ? "text-[#238D9D]" : "text-gray-500"}`}>
        <Image src={HomeSvg} alt="" className={isActive("/") ? "opacity-100" : "opacity-50"} />
        <span className="font-sterling text-[14px]">Home</span>
        {isActive("/") && <span className="h-1 w-1 rounded-full bg-[#238D9D]" />}
      </Link>

      <Link href="/earn" className={`flex flex-col items-center justify-center text-xs w-[80px] h-[60px] rounded-t-full gap-0.5 ${isActive("/earn") ? "text-[#238D9D]" : "text-gray-500"}`}>
        <Image src={Earn} alt="" className={isActive("/earn") ? "opacity-100" : "opacity-50"} />
        <span className="font-sterling text-[14px]">Earn</span>
        {isActive("/earn") && <span className="h-1 w-1 rounded-full bg-[#238D9D]" />}
      </Link>

      <Link href="/spend" className={`flex flex-col items-center justify-center text-xs w-[80px] h-[60px] rounded-t-full gap-0.5 ${isActive("/spend") ? "text-[#238D9D]" : "text-gray-500"}`}>
        <Image src={Spend} alt="" className={isActive("/spend") ? "opacity-100" : "opacity-50"} />
        <span className="font-sterling text-[14px]">Spend</span>
        {isActive("/spend") && <span className="h-1 w-1 rounded-full bg-[#238D9D]" />}
      </Link>

      <Link href="/games" className={`flex flex-col items-center justify-center text-xs w-[80px] h-[60px] rounded-t-full gap-0.5 ${gamesActive ? "text-[#238D9D]" : "text-gray-500"}`}>
        <Gamepad2 className={`h-6 w-6 ${gamesActive ? "stroke-[#238D9D]" : "stroke-gray-400"}`} />
        <span className="font-sterling text-[14px]">Games</span>
        {gamesActive && <span className="h-1 w-1 rounded-full bg-[#238D9D]" />}
      </Link>
    </nav>
  );
}
