"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/overview", label: "Overview",  icon: "◈" },
  { href: "/users",    label: "Users",     icon: "◉" },
  { href: "/games",    label: "Games",     icon: "◆" },
  { href: "/quests",   label: "Earn",      icon: "◇" },
  { href: "/vault",    label: "Vault",     icon: "◎" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex min-h-screen bg-[#0F1117]">
      {/* Sidebar */}
      <aside className="w-52 shrink-0 bg-[#13161F] border-r border-white/5 flex flex-col py-6 px-4">
        <div className="mb-8">
          <div className="text-brand-light font-bold text-lg">⚡ AkibaMiles</div>
          <div className="text-[10px] text-gray-500 mt-0.5 uppercase tracking-widest">CTO Dashboard</div>
        </div>
        <nav className="space-y-1 flex-1">
          {NAV.map(({ href, label, icon }) => {
            const active = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  active ? "bg-brand/20 text-brand-light" : "text-gray-400 hover:text-white hover:bg-white/5"
                }`}
              >
                <span className="text-base">{icon}</span>
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="text-[10px] text-gray-600 mt-6">Celo Mainnet · live</div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto px-6 py-6">
        {children}
      </main>
    </div>
  );
}
