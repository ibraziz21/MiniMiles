import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function DiceOpsPage() {
  const session = await requireAdminSession("orders.read");
  if (!session) redirect("/login");

  return (
    <div>
      <TopBar title="Dice Ops" subtitle="Round resolution, randomness, and draw monitoring" />
      <div className="p-6">
        <Card>
          <CardHeader><CardTitle>Operational Surface</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm text-slate-600">
            <p>Wire this page to the dice contract/subgraph for open rounds, filled rounds, failed randomness, and unresolved draws.</p>
            <p className="text-slate-400">Admin write actions should call server routes that wrap the existing Hardhat scripts and write audit logs.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
