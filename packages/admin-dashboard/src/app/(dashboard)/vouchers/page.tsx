import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/lib/utils";

async function getVoucherData() {
  const [issuedRes, templatesRes] = await Promise.all([
    supabase.from("issued_vouchers").select("id, status, partner_id, created_at, partners(name)").order("created_at", { ascending: false }).limit(100),
    supabase.from("spend_voucher_templates").select("id, title, active, miles_cost, partner_id, partners(name)").order("created_at", { ascending: false }).limit(100),
  ]);

  return {
    issued: (issuedRes.data ?? []) as unknown as Array<{
      id: string;
      status: string;
      partner_id: string | null;
      created_at: string;
      partners: { name: string } | null;
    }>,
    templates: (templatesRes.data ?? []) as unknown as Array<{
      id: string;
      title: string;
      active: boolean;
      miles_cost: number;
      partner_id: string;
      partners: { name: string } | null;
    }>,
  };
}

export default async function VouchersPage() {
  const session = await requireAdminSession("vouchers.read");
  if (!session) redirect("/login");

  const { issued, templates } = await getVoucherData();
  const redeemed = issued.filter((voucher) => voucher.status === "redeemed").length;
  const activeTemplates = templates.filter((template) => template.active).length;

  return (
    <div>
      <TopBar title="Vouchers & Rewards" subtitle="Voucher issuance, redemption, and template health" />
      <div className="space-y-6 p-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-slate-500">Issued</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{formatNumber(issued.length)}</p></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-slate-500">Redeemed</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{formatNumber(redeemed)}</p></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-slate-500">Active Templates</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{formatNumber(activeTemplates)}</p></CardContent></Card>
        </div>

        <Card>
          <CardHeader><CardTitle>Voucher Templates</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {templates.length === 0 && <p className="text-sm text-slate-400">No voucher templates found.</p>}
              {templates.map((template) => (
                <div key={template.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm">
                  <div>
                    <p className="font-medium text-slate-900">{template.title}</p>
                    <p className="text-xs text-slate-400">{template.partners?.name ?? template.partner_id}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-slate-500">{formatNumber(template.miles_cost)} miles</span>
                    <Badge variant={template.active ? "success" : "secondary"}>{template.active ? "active" : "inactive"}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
