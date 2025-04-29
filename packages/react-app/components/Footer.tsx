import { Earn, HomeSvg, Ticket } from "@/lib/svg";
import Image from "next/image";
import Link from "next/link";

type Props = {
  className?: string;
};


export default function Footer() {
  return (
    <nav className="fixed bottom-0 w-full bg-white border-t flex justify-around items-center">
      <Link href="/earn" className="flex flex-col items-center justify-center text-gray-600 text-xs">
        <Image src={Earn} alt="" />
        <span className="font-poppins">Earn</span>
      </Link>

      <Link href="/" className="flex flex-col items-center">
        <div className="bg-[#07955F] border-4 border-[#CFF2E5] p-3 rounded-full text-green-600">
        <Image src={HomeSvg} alt="" />
        </div>
      </Link>

      <Link href="/spend" className="flex flex-col items-center justify-center text-gray-600 text-xs ">
        <Image src={Ticket} alt="" />
        <span className="font-poppins">Spend</span>
      </Link>
    </nav>
  );
}
