import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { redirect } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { Plus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { VoucherTemplate } from "@/types";

function discountLabel(t: VoucherTemplate): string {
  if (t.voucher_type === "free") return "Free item";
  if (t.voucher_type === "percent_off") return `${t.discount_percent}% off`;
  if (t.voucher_type === "fixed_off") return `$${t.discount_cusd} off`;
  return "—";
}

export default async function VouchersPage() {
  const session = await requireMerchantSession();
  if (!session) redirect("/login");

  const { data: rawTemplates } = await supabase
    .from("spend_voucher_templates")
    .select("id,title,voucher_type,miles_cost,discount_percent,discount_cusd,applicable_category,linked_product_id,retail_value_cusd,active,expires_at,global_cap")
    .eq("partner_id", session.partnerId)
    .order("created_at", { ascending: false });

  // Enrich with product names
  const productIds = [...new Set((rawTemplates ?? []).map((t) => t.linked_product_id).filter(Boolean))] as string[];
  let productNames: Record<string, string> = {};
  if (productIds.length > 0) {
    const { data: prods } = await supabase.from("merchant_products").select("id,name").in("id", productIds);
    for (const p of prods ?? []) productNames[p.id] = p.name;
  }
  const templates = (rawTemplates ?? []).map((t) => ({
    ...t,
    linked_product_name: t.linked_product_id ? (productNames[t.linked_product_id] ?? null) : null,
  }));

  const canEdit = ["owner", "manager"].includes(session.role);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TopBar
        title="Voucher Templates"
        subtitle={`${(templates ?? []).length} template${(templates ?? []).length !== 1 ? "s" : ""}`}
        actions={
          canEdit ? (
            <Link href="/vouchers/new">
              <Button size="sm" className="gap-1.5">
                <Plus className="h-4 w-4" /> New Template
              </Button>
            </Link>
          ) : undefined
        }
      />
      <div className="flex-1 overflow-y-auto p-6">
        <Card>
          <CardContent className="p-0">
            {(templates ?? []).length === 0 ? (
              <div className="py-16 text-center text-sm text-gray-500">
                No voucher templates yet.{" "}
                {canEdit && <Link href="/vouchers/new" className="text-[#238D9D] hover:underline">Create one →</Link>}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                      <th className="px-5 py-3">Title</th>
                      <th className="px-5 py-3">Type</th>
                      <th className="px-5 py-3">Cost</th>
                      <th className="px-5 py-3">Discount</th>
                      <th className="px-5 py-3">Scope</th>
                      <th className="px-5 py-3">Status</th>
                      {canEdit && <th className="px-5 py-3">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {(templates as unknown as VoucherTemplate[]).map((t) => (
                      <tr key={t.id} className="hover:bg-gray-50">
                        <td className="px-5 py-3 font-medium text-gray-900">{t.title}</td>
                        <td className="px-5 py-3 text-gray-500 capitalize">{t.voucher_type.replace("_", " ")}</td>
                        <td className="px-5 py-3 text-gray-700">{t.miles_cost} miles</td>
                        <td className="px-5 py-3 text-gray-700">{discountLabel(t)}</td>
                        <td className="px-5 py-3 text-gray-500">
                          {(t as any).linked_product_name
                            ? <span className="inline-flex items-center gap-1 text-[#238D9D] font-medium text-xs rounded-full bg-[#238D9D11] px-2 py-0.5">📦 {(t as any).linked_product_name}</span>
                            : t.applicable_category
                            ? <span className="text-xs">{t.applicable_category}</span>
                            : <span className="text-xs text-gray-400">All products</span>
                          }
                        </td>
                        <td className="px-5 py-3">
                          <Badge className={t.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-700"}>
                            {t.active ? "Active" : "Inactive"}
                          </Badge>
                        </td>
                        {canEdit && (
                          <td className="px-5 py-3">
                            <Link href={`/vouchers/${t.id}/edit`} className="inline-flex items-center gap-1 text-[#238D9D] hover:underline text-xs">
                              <Pencil className="h-3 w-3" /> Edit
                            </Link>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
