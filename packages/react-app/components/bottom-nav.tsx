import { Home, Wallet, Activity } from "lucide-react";
import clsx from "clsx";
import Link from "next/link";

export const BottomNav = () => {
  return (
    <nav className="fixed bottom-0 w-full bg-[#e6faee] border-t px-4 py-2 flex justify-between items-center">
     {/* Earn */}
     <Link href="/earn" className="flex flex-col items-center text-gray-600 text-xs">
        <Activity className="h-5 w-5" />
        <span>Earn</span>
      </Link>

      {/* Home */}
      <Link href="/" className="flex flex-col items-center">
        <div className="bg-white border-4 border-[#238D9D] p-3 rounded-full text-[#238D9D]">
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
};
