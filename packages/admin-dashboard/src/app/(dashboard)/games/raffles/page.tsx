import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function RaffleOpsPage() {
  const session = await requireAdminSession("orders.read");
  if (!session) redirect("/login");

  return (
    <div>
      <TopBar title="Raffle Ops" subtitle="Active raffles, entries, winners, and payout review" />
      <div className="p-6">
        <Card>
          <CardHeader><CardTitle>Operational Surface</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm text-slate-600">
            <p>Use this page for raffle inventory, entry counts, winner review, and unresolved payout visibility.</p>
            <p className="text-slate-400">Connect to raffle subgraph or contract reads when the canonical data source is finalized.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
