"use client";

import { Home, Wallet, Activity, Gamepad2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export const BottomNav = () => {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  return (
    <nav className="fixed bottom-0 w-full bg-white border-t border-[#E8F5F0] px-6 py-2 flex justify-between items-center shadow-[0_-2px_12px_rgba(0,0,0,0.06)]">
      {/* Earn */}
      <Link
        href="/earn"
        className={`flex flex-col items-center gap-0.5 text-xs transition-colors ${
          isActive("/earn") ? "text-[#238D9D]" : "text-[#A0A0A0]"
        }`}
      >
        <Activity className={`h-5 w-5 transition-colors ${isActive("/earn") ? "stroke-[#238D9D]" : ""}`} />
        <span className={`font-medium ${isActive("/earn") ? "font-bold" : ""}`}>Earn</span>
        {isActive("/earn") && <span className="h-1 w-1 rounded-full bg-[#238D9D]" />}
      </Link>

      {/* Games */}
      <Link
        href="/games"
        className={`flex flex-col items-center gap-0.5 text-xs transition-colors ${
          isActive("/games") || isActive("/dice") ? "text-[#238D9D]" : "text-[#A0A0A0]"
        }`}
      >
        <Gamepad2 className={`h-5 w-5 ${isActive("/games") || isActive("/dice") ? "stroke-[#238D9D]" : ""}`} />
        <span className={`font-medium ${isActive("/games") || isActive("/dice") ? "font-bold" : ""}`}>Games</span>
        {(isActive("/games") || isActive("/dice")) && <span className="h-1 w-1 rounded-full bg-[#238D9D]" />}
      </Link>

      {/* Home — center focal point */}
      <Link href="/" className="flex flex-col items-center -mt-4">
        <div
          className={`p-3 rounded-full shadow-md transition-all ${
            isActive("/")
              ? "bg-[#238D9D] text-white border-4 border-[#238D9D]"
              : "bg-white text-[#238D9D] border-4 border-[#238D9D]"
          }`}
        >
          <Home className="h-5 w-5" />
        </div>
        <span className={`text-xs mt-1 font-medium ${isActive("/") ? "text-[#238D9D] font-bold" : "text-[#A0A0A0]"}`}>
          Home
        </span>
      </Link>

      {/* Spend */}
      <Link
        href="/spend"
        className={`flex flex-col items-center gap-0.5 text-xs transition-colors ${
          isActive("/spend") ? "text-[#238D9D]" : "text-[#A0A0A0]"
        }`}
      >
        <Wallet className={`h-5 w-5 ${isActive("/spend") ? "stroke-[#238D9D]" : ""}`} />
        <span className={`font-medium ${isActive("/spend") ? "font-bold" : ""}`}>Spend</span>
        {isActive("/spend") && <span className="h-1 w-1 rounded-full bg-[#238D9D]" />}
      </Link>
    </nav>
  );
};
