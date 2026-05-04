import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatNumber } from "@/lib/utils";
import { MerchantControls } from "@/components/merchants/MerchantControls";
import { AddMerchantNote } from "@/components/merchants/AddMerchantNote";
import { ArrowLeft } from "lucide-react";
import type { ComponentType, SVGProps } from "react";

const ArrowLeftIcon = ArrowLeft as unknown as ComponentType<SVGProps<SVGSVGElement>>;

async function getMerchantDetail(id: string) {
  const [partnerRes, settingsRes, ordersRes, productsRes, vouchersRes, teamRes, notesRes] = await Promise.all([
    supabase.from("partners").select("*").eq("id", id).single(),
    supabase.from("partner_settings").select("*").eq("partner_id", id).maybeSingle(),
    supabase.from("merchant_transactions").select("id, status, amount_cusd, item_name, created_at").eq("partner_id", id).order("created_at", { ascending: false }).limit(10),
    supabase.from("merchant_products").select("id, name, price_cusd, active").eq("merchant_id", id),
    supabase.from("spend_voucher_templates").select("id, title, active, miles_cost").eq("partner_id", id),
    supabase.from("merchant_users").select("id, email, name, role, is_active").eq("partner_id", id),
    supabase.from("merchant_admin_notes").select("id, note, created_at, admin_users(name, email)").eq("partner_id", id).order("created_at", { ascending: false }),
  ]);

  if (!partnerRes.data) return null;

  const orders = ordersRes.data ?? [];
  const totalRevenue = orders.filter((o) => ["delivered", "received", "completed"].includes(o.status)).reduce((s, o) => s + (o.amount_cusd ?? 0), 0);

  return {
    partner: partnerRes.data,
    settings: settingsRes.data ?? null,
    recent_orders: orders,
    total_revenue_cusd: Math.round(totalRevenue * 100) / 100,
    products: productsRes.data ?? [],
    voucher_templates: vouchersRes.data ?? [],
    team: teamRes.data ?? [],
    notes: notesRes.data ?? [],
  };
}

const STATUS_COLORS: Record<string, string> = {
  placed: "warning",
  accepted: "default",
  packed: "default",
  out_for_delivery: "default",
  delivered: "success",
  received: "success",
  completed: "success",
  cancelled: "destructive",
};

export default async function MerchantDetailPage({ params }: { params: { id: string } }) {
  const session = await requireAdminSession("merchants.read");
  if (!session) redirect("/login");

  const detail = await getMerchantDetail(params.id);
  if (!detail) notFound();

  const { partner, settings, recent_orders, total_revenue_cusd, products, voucher_templates, team, notes } = detail;

  return (
    <div>
      <TopBar title={partner.name} subtitle="Merchant detail" />
      <div className="p-6 space-y-6">
        <Link href="/merchants" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900">
          <ArrowLeftIcon className="h-3.5 w-3.5" />
          Back to merchants
        </Link>

        {/* Summary */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-slate-500">Store Status</CardTitle></CardHeader>
            <CardContent>
              {settings?.store_active ? (
                <Badge variant="success">Active</Badge>
              ) : settings ? (
                <Badge variant="secondary">Inactive</Badge>
              ) : (
                <Badge variant="outline">No settings</Badge>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-slate-500">Revenue (recent)</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">${formatNumber(total_revenue_cusd)}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-slate-500">Team Members</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">{team.length}</p></CardContent>
          </Card>
        </div>

        {/* Controls */}
        <Card>
          <CardHeader><CardTitle>Admin Controls</CardTitle></CardHeader>
          <CardContent>
            <MerchantControls merchantId={params.id} storeActive={settings?.store_active ?? null} />
          </CardContent>
        </Card>

        {/* Recent orders */}
        <Card>
          <CardHeader><CardTitle>Recent Orders</CardTitle></CardHeader>
          <CardContent>
            {recent_orders.length === 0 ? (
              <p className="text-sm text-slate-400">No orders yet.</p>
            ) : (
              <div className="space-y-2">
                {recent_orders.map((o) => (
                  <div key={o.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm">
                    <div>
                      <p className="font-medium text-slate-900">{o.item_name ?? o.id.slice(0, 8)}</p>
                      <p className="text-xs text-slate-400">{formatDate(o.created_at)}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-slate-700">${o.amount_cusd ?? 0}</span>
                      <Badge variant={(STATUS_COLORS[o.status] as "success" | "warning" | "destructive" | "default") ?? "secondary"}>{o.status}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Products */}
        <Card>
          <CardHeader><CardTitle>Products ({products.length})</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {products.map((p) => (
                <span key={p.id} className={`rounded-full px-3 py-1 text-xs ${p.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                  {p.name} — ${p.price_cusd}
                </span>
              ))}
              {products.length === 0 && <p className="text-sm text-slate-400">No products.</p>}
            </div>
          </CardContent>
        </Card>

        {/* Voucher templates */}
        <Card>
          <CardHeader><CardTitle>Voucher Templates ({voucher_templates.length})</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {voucher_templates.map((v) => (
                <span key={v.id} className={`rounded-full px-3 py-1 text-xs ${v.active ? "bg-[#238D9D]/10 text-[#238D9D]" : "bg-slate-100 text-slate-500"}`}>
                  {v.title} ({v.miles_cost} miles)
                </span>
              ))}
              {voucher_templates.length === 0 && <p className="text-sm text-slate-400">No templates.</p>}
            </div>
          </CardContent>
        </Card>

        {/* Team */}
        <Card>
          <CardHeader><CardTitle>Team</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {team.map((u) => (
                <div key={u.id} className="flex items-center justify-between text-sm">
                  <div>
                    <p className="font-medium text-slate-900">{u.name ?? u.email}</p>
                    <p className="text-xs text-slate-400">{u.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{u.role}</Badge>
                    {!u.is_active && <Badge variant="destructive">Inactive</Badge>}
                  </div>
                </div>
              ))}
              {team.length === 0 && <p className="text-sm text-slate-400">No team members.</p>}
            </div>
          </CardContent>
        </Card>

        {/* Internal notes */}
        <Card>
          <CardHeader><CardTitle>Internal Notes</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {notes.length === 0 && <p className="text-sm text-slate-400">No notes yet.</p>}
            {(notes as unknown as Array<{ id: string; note: string; created_at: string; admin_users?: { name: string | null; email: string } | null }>).map((note) => (
              <div key={note.id} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5">
                <p className="text-sm text-slate-700">{note.note}</p>
                <p className="mt-1 text-xs text-slate-400">{note.admin_users?.name ?? note.admin_users?.email ?? "Unknown"} · {formatDate(note.created_at)}</p>
              </div>
            ))}
            <AddMerchantNote merchantId={params.id} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
