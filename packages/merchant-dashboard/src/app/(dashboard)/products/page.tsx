import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { redirect } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { Plus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MerchantProduct } from "@/types";

export default async function ProductsPage() {
  const session = await requireMerchantSession();
  if (!session) redirect("/login");

  const { data: products } = await supabase
    .from("merchant_products")
    .select("id,name,category,price_cusd,active,image_url,created_at")
    .eq("merchant_id", session.partnerId)
    .order("created_at", { ascending: false });

  const canEdit = ["owner", "manager"].includes(session.role);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TopBar
        title="Products"
        subtitle={`${(products ?? []).length} product${(products ?? []).length !== 1 ? "s" : ""}`}
        actions={
          canEdit ? (
            <Link href="/products/new">
              <Button size="sm" className="gap-1.5">
                <Plus className="h-4 w-4" /> New Product
              </Button>
            </Link>
          ) : undefined
        }
      />
      <div className="flex-1 overflow-y-auto p-6">
        <Card>
          <CardContent className="p-0">
            {(products ?? []).length === 0 ? (
              <div className="py-16 text-center text-sm text-gray-500">
                No products yet.{" "}
                {canEdit && (
                  <Link href="/products/new" className="text-[#238D9D] hover:underline">
                    Add your first product →
                  </Link>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                      <th className="px-5 py-3">Name</th>
                      <th className="px-5 py-3">Category</th>
                      <th className="px-5 py-3">Price</th>
                      <th className="px-5 py-3">Status</th>
                      {canEdit && <th className="px-5 py-3">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {(products as MerchantProduct[]).map((p) => (
                      <tr key={p.id} className="hover:bg-gray-50">
                        <td className="px-5 py-3 font-medium text-gray-900">{p.name}</td>
                        <td className="px-5 py-3 text-gray-500 capitalize">{p.category ?? "—"}</td>
                        <td className="px-5 py-3 text-gray-700">${Number(p.price_cusd).toFixed(2)}</td>
                        <td className="px-5 py-3">
                          <Badge className={p.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-700"}>
                            {p.active ? "Active" : "Inactive"}
                          </Badge>
                        </td>
                        {canEdit && (
                          <td className="px-5 py-3">
                            <Link
                              href={`/products/${p.id}/edit`}
                              className="inline-flex items-center gap-1 text-[#238D9D] hover:underline text-xs"
                            >
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
