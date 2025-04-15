import { Activity, Home, Wallet } from "lucide-react";
import Link from "next/link";

type Props = {
  className?: string;
};


export default function Footer() {
  return (
    <nav className="fixed bottom-0 w-full bg-[#e6faee] border-t px-4 py-2 flex justify-between items-center p-4">
     <Link href="/earn" className="flex flex-col items-center text-gray-600 text-xs">
        <Activity className="h-5 w-5" />
        <span>Earn</span>
      </Link>

      {/* Home */}
      <Link href="/" className="flex flex-col items-center">
        <div className="bg-white border-4 border-green-300 p-3 rounded-full text-green-600">
          <Home className="h-5 w-5" />
        </div>
        <span className="text-xs mt-1">Home</span>
      </Link>

      {/* Spend */}
      <Link href="/spend" className="flex flex-col items-center text-gray-600 text-xs">
        <Wallet className="h-5 w-5" />
        <span>Spend</span>
      </Link>
    </nav>
  );
}
