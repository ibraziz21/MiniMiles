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

  const { data: templates } = await supabase
    .from("spend_voucher_templates")
    .select("id,title,voucher_type,miles_cost,discount_percent,discount_cusd,applicable_category,active,expires_at,global_cap")
    .eq("partner_id", session.partnerId)
    .order("created_at", { ascending: false });

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
                      <th className="px-5 py-3">Category</th>
                      <th className="px-5 py-3">Status</th>
                      {canEdit && <th className="px-5 py-3">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {(templates as VoucherTemplate[]).map((t) => (
                      <tr key={t.id} className="hover:bg-gray-50">
                        <td className="px-5 py-3 font-medium text-gray-900">{t.title}</td>
                        <td className="px-5 py-3 text-gray-500 capitalize">{t.voucher_type.replace("_", " ")}</td>
                        <td className="px-5 py-3 text-gray-700">{t.miles_cost} miles</td>
                        <td className="px-5 py-3 text-gray-700">{discountLabel(t)}</td>
                        <td className="px-5 py-3 text-gray-500">{t.applicable_category ?? "All"}</td>
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
