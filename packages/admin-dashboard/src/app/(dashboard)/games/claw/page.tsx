import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function ClawOpsPage() {
  const session = await requireAdminSession("orders.read");
  if (!session) redirect("/login");

  return (
    <div>
      <TopBar title="Claw Ops" subtitle="Batch, settlement, and voucher issuance monitoring" />
      <div className="p-6">
        <Card>
          <CardHeader><CardTitle>Operational Surface</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm text-slate-600">
            <p>Track active batch state, pending settlement, voucher registry events, and reward vault health here.</p>
            <p className="text-slate-400">Batch rotation and settlement actions should be confirmation-gated and audited.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
