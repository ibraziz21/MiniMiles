import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { VoucherTabs } from "./VoucherTabs";

export const metadata = { title: "Vouchers — Akiba Hub" };
export const revalidate = 60;

type VoucherTemplate = {
  id: string;
  title: string;
  voucher_type: "free" | "percent_off" | "fixed_off";
  miles_cost: number;
  discount_percent: number | null;
  discount_cusd: number | null;
  applicable_category: string | null;
  retail_value_cusd: number | null;
  partners: {
    id: string;
    slug: string;
    name: string;
    image_url: string | null;
  } | null;
};

async function getAllTemplates(): Promise<VoucherTemplate[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("spend_voucher_templates")
    .select(`
      id, title, voucher_type, miles_cost, discount_percent, discount_cusd,
      applicable_category, retail_value_cusd,
      partners ( id, slug, name, image_url )
    `)
    .eq("active", true)
    .order("miles_cost", { ascending: true });

  return ((data ?? []) as unknown[]).map((item) => {
    const d = item as Record<string, unknown>;
    const partners = Array.isArray(d.partners) ? d.partners[0] ?? null : d.partners;
    return { ...d, partners } as VoucherTemplate;
  });
}

export default async function VouchersPage() {
  const [templates, { data: { user } }] = await Promise.all([
    getAllTemplates(),
    (await createClient()).auth.getUser(),
  ]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-sterling text-3xl font-semibold text-akiba-ink">Vouchers</h1>
          <p className="mt-2 text-akiba-muted">
            Spend your AkibaMiles on discounts. Browse what&apos;s available and redeem in MiniPay.
          </p>
        </div>

      </div>

      {/* How it works strip */}
      <div className="mb-8 grid gap-3 rounded-2xl border border-akiba-teal/20 bg-akiba-tint p-4 sm:grid-cols-3 sm:p-5">
        {[
          { icon: "1", label: "Choose a voucher below" },
          { icon: "2", label: "Redeem instantly with AkibaMiles" },
          { icon: "3", label: "Show the QR or code at checkout" },
        ].map(({ icon, label }) => (
          <div key={icon} className="flex items-center gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-akiba-teal text-xs font-bold text-white">
              {icon}
            </span>
            <p className="text-sm font-medium text-akiba-ink">{label}</p>
          </div>
        ))}
      </div>

      {/* Tabs component (client-side for "My vouchers" tab) */}
      <VoucherTabs templates={templates} isSignedIn={!!user} />
    </main>
  );
}
