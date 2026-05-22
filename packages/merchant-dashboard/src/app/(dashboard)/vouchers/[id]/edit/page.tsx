import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { redirect, notFound } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MerchantProduct, VoucherTemplate } from "@/types";
import EditVoucherForm from "./EditVoucherForm";

export default async function EditVoucherTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireMerchantSession();
  if (!session) redirect("/login");

  const { id } = await params;

  const [{ data: template }, { data: products }] = await Promise.all([
    supabase
      .from("spend_voucher_templates")
      .select("id,title,voucher_type,miles_cost,discount_percent,discount_cusd,applicable_category,linked_product_id,retail_value_cusd,cooldown_seconds,global_cap,expires_at,active")
      .eq("id", id)
      .eq("partner_id", session.partnerId)
      .single(),
    supabase
      .from("merchant_products")
      .select("id,merchant_id,name,description,price_cusd,category,image_url,active,created_at,updated_at")
      .eq("merchant_id", session.partnerId)
      .order("name", { ascending: true }),
  ]);

  if (!template) notFound();

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TopBar title="Edit Voucher Template" subtitle="Update template details" />
      <div className="flex-1 overflow-y-auto p-6">
        <Card className="max-w-lg">
          <CardHeader><CardTitle>Template details</CardTitle></CardHeader>
          <CardContent>
            <EditVoucherForm
              id={id}
              template={template as VoucherTemplate}
              products={(products ?? []) as MerchantProduct[]}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
