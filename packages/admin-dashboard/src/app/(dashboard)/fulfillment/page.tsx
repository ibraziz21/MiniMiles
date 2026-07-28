import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { TopBar } from "@/components/layout/TopBar";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";
import { FulfillmentJobActions } from "@/components/fulfillment/FulfillmentJobActions";

type Job = {
  id: string;
  order_id: string;
  executor: string;
  // email added for react-app's code_delivery digital products (voucher-merchant-checkout-spec.md
  // §3) — a gift-card-style item has no phone recipient, it needs an address to email a code to.
  payload: { product_id?: string; item_name?: string; recipient_name?: string; phone?: string; email?: string };
  attempts: number;
  status: "pending" | "processing" | "delivered" | "failed";
  provider_ref: string | null;
  last_error: string | null;
  created_at: string;
};

async function getJobs() {
  const { data } = await supabase
    .from("fulfillment_jobs")
    .select("id, order_id, executor, payload, attempts, status, provider_ref, last_error, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  return (data ?? []) as Job[];
}

const STATUS_VARIANT: Record<Job["status"], "warning" | "default" | "success" | "destructive"> = {
  pending: "warning",
  processing: "default",
  delivered: "success",
  failed: "destructive",
};

export default async function FulfillmentPage() {
  const session = await requireAdminSession("orders.read");
  if (!session) redirect("/login");

  const jobs = await getJobs();
  const pending = jobs.filter((j) => j.status === "pending" || j.status === "processing").length;

  return (
    <div>
      <TopBar title="Digital Fulfilment" subtitle={`${pending} awaiting action · manual executor`} />
      <div className="p-6">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-xs font-medium uppercase tracking-wider text-slate-400">
                  <th className="px-4 py-3 text-left">Order</th>
                  <th className="px-4 py-3 text-left">Item</th>
                  <th className="px-4 py-3 text-left">Recipient</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Ref / error</th>
                  <th className="px-4 py-3 text-left">Created</th>
                  <th className="px-4 py-3 text-left">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {jobs.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">No fulfilment jobs.</td></tr>
                )}
                {jobs.map((job) => (
                  <tr key={job.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{job.order_id.slice(0, 8)}…</td>
                    <td className="px-4 py-3 text-slate-700">{job.payload.item_name ?? "—"}</td>
                    <td className="px-4 py-3">
                      <p className="text-slate-900">{job.payload.recipient_name ?? "—"}</p>
                      <p className="text-xs text-slate-400">{job.payload.phone ?? job.payload.email ?? ""}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_VARIANT[job.status]}>{job.status}</Badge>
                      {job.attempts > 0 && <span className="ml-1.5 text-xs text-slate-400">×{job.attempts}</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 max-w-[220px] truncate">
                      {job.provider_ref ?? job.last_error ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{formatDateTime(job.created_at)}</td>
                    <td className="px-4 py-3">
                      <FulfillmentJobActions jobId={job.id} status={job.status} />
                    </td>
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
