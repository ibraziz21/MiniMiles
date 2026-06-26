import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { redirect } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { VoucherTemplate } from "@/types";
import NewProgramForm from "./NewProgramForm";

export default async function NewProgramPage() {
  const session = await requireMerchantSession();
  if (!session) redirect("/login");
  if (!["owner", "manager"].includes(session.role)) redirect("/vouchers/programs");

  const { data: templates } = await supabase
    .from("spend_voucher_templates")
    .select("id,title,voucher_type,miles_cost,discount_percent,discount_cusd,applicable_category,linked_product_id,retail_value_cusd,active,expires_at")
    .eq("partner_id", session.partnerId)
    .eq("active", true)
    .order("title", { ascending: true });

  if (!templates || templates.length === 0) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar title="New Program" subtitle="Create a voucher distribution program" />
        <div className="p-6">
          <p className="text-sm text-gray-500">
            You need at least one active voucher template before creating a program.{" "}
            <a href="/vouchers/new" className="text-[#238D9D] hover:underline">Create a template →</a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TopBar title="New Voucher Program" subtitle="Define distribution rules and channel allocations" />
      <div className="flex-1 overflow-y-auto p-6">
        <Card className="max-w-lg">
          <CardHeader><CardTitle>Program details</CardTitle></CardHeader>
          <CardContent>
            <NewProgramForm templates={(templates ?? []) as unknown as VoucherTemplate[]} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
