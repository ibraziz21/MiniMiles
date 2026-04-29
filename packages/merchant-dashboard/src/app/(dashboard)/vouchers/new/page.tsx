import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { redirect } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MerchantProduct } from "@/types";
import NewVoucherForm from "./NewVoucherForm";

export default async function NewVoucherTemplatePage() {
  const session = await requireMerchantSession();
  if (!session) redirect("/login");

  const { data: products } = await supabase
    .from("merchant_products")
    .select("id,merchant_id,name,description,price_cusd,category,image_url,active,created_at,updated_at")
    .eq("merchant_id", session.partnerId)
    .order("name", { ascending: true });

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TopBar title="New Voucher Template" subtitle="Define a redeemable voucher" />
      <div className="flex-1 overflow-y-auto p-6">
        <Card className="max-w-lg">
          <CardHeader><CardTitle>Template details</CardTitle></CardHeader>
          <CardContent>
            <NewVoucherForm products={(products ?? []) as MerchantProduct[]} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
