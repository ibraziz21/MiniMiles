import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { redirect } from "next/navigation";
import Link from "next/link";
import { TopBar } from "@/components/layout/TopBar";
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/lib/utils";
import { Store, CheckCircle, XCircle } from "lucide-react";
import type { ComponentType, SVGProps } from "react";

const StoreIcon = Store as unknown as ComponentType<SVGProps<SVGSVGElement>>;
const CheckCircleIcon = CheckCircle as unknown as ComponentType<SVGProps<SVGSVGElement>>;
const XCircleIcon = XCircle as unknown as ComponentType<SVGProps<SVGSVGElement>>;

async function getMerchants() {
  const [partnersRes, settingsRes, orderCountRes, teamRes] = await Promise.all([
    supabase.from("partners").select("id, slug, name, country, image_url").order("name"),
    supabase.from("partner_settings").select("partner_id, store_active, wallet_address"),
    supabase.from("merchant_transactions").select("partner_id, status"),
    supabase.from("merchant_users").select("partner_id"),
  ]);

  const settingsMap: Record<string, { store_active: boolean }> = {};
  for (const s of settingsRes.data ?? []) settingsMap[s.partner_id] = s;

  const orderMap: Record<string, { total: number; active: number }> = {};
  for (const o of orderCountRes.data ?? []) {
    if (!orderMap[o.partner_id]) orderMap[o.partner_id] = { total: 0, active: 0 };
    orderMap[o.partner_id].total++;
    if (!["received", "completed", "cancelled"].includes(o.status)) orderMap[o.partner_id].active++;
  }

  const teamMap: Record<string, number> = {};
  for (const u of teamRes.data ?? []) teamMap[u.partner_id] = (teamMap[u.partner_id] ?? 0) + 1;

  return (partnersRes.data ?? []).map((p) => ({
    ...p,
    store_active: settingsMap[p.id]?.store_active ?? null,
    total_orders: orderMap[p.id]?.total ?? 0,
    active_orders: orderMap[p.id]?.active ?? 0,
    team_count: teamMap[p.id] ?? 0,
  }));
}

export default async function MerchantsPage() {
  const session = await requireAdminSession("merchants.read");
  if (!session) redirect("/login");

  const merchants = await getMerchants();

  return (
    <div>
      <TopBar title="Merchants" subtitle={`${merchants.length} merchant${merchants.length !== 1 ? "s" : ""} registered`} />
      <div className="p-6">
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-xs font-medium uppercase tracking-wider text-slate-400">
                  <th className="px-4 py-3 text-left">Merchant</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-right">Total Orders</th>
                  <th className="px-4 py-3 text-right">Active Orders</th>
                  <th className="px-4 py-3 text-right">Team</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {merchants.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">No merchants yet.</td></tr>
                )}
                {merchants.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/merchants/${m.id}`} className="flex items-center gap-2 font-medium text-slate-900 hover:text-[#238D9D]">
                        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 shrink-0">
                          {m.image_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={m.image_url} alt={m.name} className="h-7 w-7 rounded-lg object-cover" />
                          ) : (
                            <StoreIcon className="h-3.5 w-3.5 text-slate-400" />
                          )}
                        </div>
                        <span>{m.name}</span>
                      </Link>
                      <p className="mt-0.5 pl-9 text-xs text-slate-400">{m.country ?? "—"}</p>
                    </td>
                    <td className="px-4 py-3">
                      {m.store_active === null ? (
                        <Badge variant="secondary">No settings</Badge>
                      ) : m.store_active ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><CheckCircleIcon className="h-3.5 w-3.5" /> Active</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-slate-400"><XCircleIcon className="h-3.5 w-3.5" /> Inactive</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-700">{formatNumber(m.total_orders)}</td>
                    <td className="px-4 py-3 text-right">
                      {m.active_orders > 0 ? (
                        <span className="font-mono font-semibold text-amber-600">{m.active_orders}</span>
                      ) : (
                        <span className="font-mono text-slate-400">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-500">{m.team_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
