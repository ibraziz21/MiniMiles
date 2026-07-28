import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { redirect } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent } from "@/components/ui/card";
import type { MerchantProduct } from "@/types";
import VoucherWizard from "./VoucherWizard";

export default async function CreateVoucherPage() {
  const session = await requireMerchantSession();
  if (!session) redirect("/login");
  if (!["owner", "manager"].includes(session.role)) redirect("/vouchers");

  const { data: products } = await supabase
    .from("merchant_products")
    .select("id,merchant_id,name,description,price_cusd,category,image_url,active,created_at,updated_at")
    .eq("merchant_id", session.partnerId)
    .order("name", { ascending: true });

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TopBar title="Create voucher" subtitle="Define the offer, availability, and distribution in one flow" />
      <div className="flex-1 overflow-y-auto p-6">
        <Card className="max-w-3xl">
          <CardContent className="p-6">
            <VoucherWizard products={(products ?? []) as MerchantProduct[]} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
