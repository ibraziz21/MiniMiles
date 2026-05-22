"use client";

import { Sidebar } from "@/components/layout/Sidebar";
import { useNewOrdersBadge } from "@/hooks/useNewOrdersBadge";
import type { MerchantSessionData } from "@/types";

interface Props {
  session: MerchantSessionData;
  children: React.ReactNode;
}

export function DashboardShell({ session, children }: Props) {
  const newOrdersCount = useNewOrdersBadge();

  return (
    <div className="merchant-app-shell flex h-screen overflow-hidden">
      <Sidebar partnerName={session.partnerName} newOrdersCount={newOrdersCount} />
      <main className="relative flex flex-1 flex-col overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(35,141,157,0.12),transparent_32%),radial-gradient(circle_at_bottom_left,rgba(35,141,157,0.08),transparent_28%)]" />
        {children}
      </main>
    </div>
  );
}
