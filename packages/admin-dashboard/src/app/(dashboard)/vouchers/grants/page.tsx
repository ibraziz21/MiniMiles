import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Direct member grants for Akiba-funded vouchers — see
// packages/admin-dashboard/docs/akiba-funded-voucher-admin-spec.md §11.
// Scaffolded ahead of the Akiba-Platform funding runtime; see /vouchers/funds.
export default async function VoucherGrantsPage() {
  const session = await requireAdminSession("voucher_funds.read");
  if (!session) redirect("/login");

  return (
    <div>
      <TopBar
        title="Member Grants"
        subtitle="Direct voucher grants to eligible members, with masked identity and reason"
      />
      <div className="space-y-6 p-6">
        <Card>
          <CardHeader>
            <CardTitle>No direct grants yet</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-slate-500">
            <p>
              Direct grants let an authorized operator (permission{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5">voucher_funds.grant</code>) issue
              one voucher to a searched, eligible canonical member. This requires the
              Akiba-Platform grant endpoint and eligibility evaluator, which have not shipped yet.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
