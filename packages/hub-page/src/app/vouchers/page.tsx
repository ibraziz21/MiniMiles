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

const HOW_IT_WORKS = [
  { n: "1", short: "Choose",        long: "Choose a voucher below" },
  { n: "2", short: "Redeem",        long: "Redeem instantly with AkibaMiles" },
  { n: "3", short: "Show at checkout", long: "Show the QR or code at checkout" },
];

export default async function VouchersPage() {
  const [templates, { data: { user } }] = await Promise.all([
    getAllTemplates(),
    (await createClient()).auth.getUser(),
  ]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-5 sm:py-8 sm:px-6 lg:px-8">

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="mb-4 sm:mb-8">
        <h1 className="font-sterling text-2xl font-semibold text-akiba-ink sm:text-3xl">
          Vouchers
        </h1>
        <p className="mt-1 text-sm text-akiba-muted sm:mt-2 sm:text-base">
          Spend your AkibaMiles on discounts — instantly, no wallet signature needed.
        </p>
      </div>

      {/* ── How it works ─────────────────────────────────────────────────── */}

      {/* Mobile: compact pill row */}
      <div className="mb-4 flex items-center gap-2 overflow-x-auto pb-0.5 sm:hidden">
        {HOW_IT_WORKS.map(({ n, short }, i) => (
          <div key={n} className="flex shrink-0 items-center gap-1.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-akiba-teal text-[10px] font-bold text-white">
              {n}
            </span>
            <span className="text-xs font-medium text-akiba-ink">{short}</span>
            {i < HOW_IT_WORKS.length - 1 && (
              <span className="ml-0.5 text-akiba-line">›</span>
            )}
          </div>
        ))}
      </div>

      {/* Desktop: full info strip */}
      <div className="mb-8 hidden sm:grid sm:grid-cols-3 gap-3 rounded-2xl border border-akiba-teal/20 bg-akiba-tint p-5">
        {HOW_IT_WORKS.map(({ n, long }) => (
          <div key={n} className="flex items-center gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-akiba-teal text-xs font-bold text-white">
              {n}
            </span>
            <p className="text-sm font-medium text-akiba-ink">{long}</p>
          </div>
        ))}
      </div>

      {/* ── Tabs + cards ─────────────────────────────────────────────────── */}
      <VoucherTabs templates={templates} isSignedIn={!!user} />

    </main>
  );
}
