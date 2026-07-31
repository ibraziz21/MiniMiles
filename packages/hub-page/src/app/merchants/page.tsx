import { Store } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  listPublicMerchants,
  listDirectoryCities,
  getCanonicalVoucherCounts,
} from "@/lib/merchants/queries";
import { getTopOffers, toMerchantValueSummary, getSignedInBalance } from "@/lib/merchants/enrich";
import { createClient } from "@/lib/supabase/server";
import { MerchantFilters } from "./MerchantFilters";

export const metadata = {
  title: "Merchants — Akiba Pass",
  description: "Find places to earn and use AkibaMiles—near you and online.",
};

// A live-inventory directory (publish state, voucher availability) must
// never be served from a stale static/ISR cache, and must never be
// statically executed at build time.
export const dynamic = "force-dynamic";

async function getCategories() {
  const admin = createAdminClient();
  const { data } = await admin
    .from("merchant_categories")
    .select("slug, name")
    .eq("active", true)
    .order("sort_order");
  return data ?? [];
}

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function MerchantsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const q = first(searchParams.q);
  const category = first(searchParams.category);
  const city = first(searchParams.city);
  const mode = first(searchParams.mode) as "physical" | "online" | "all" | undefined;
  const latParam = first(searchParams.lat);
  const lngParam = first(searchParams.lng);
  const lat = latParam ? Number(latParam) : undefined;
  const lng = lngParam ? Number(lngParam) : undefined;

  try {
    const [{ merchants, next_cursor }, categories, cities] = await Promise.all([
      listPublicMerchants({ q, category, city, mode, lat, lng, limit: 24 }),
      getCategories(),
      listDirectoryCities(),
    ]);

    let initialMerchants = merchants.map((m) => toMerchantValueSummary(m, undefined, null, q ?? null, 0));
    if (merchants.length > 0) {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const partnerIds = merchants.map((m) => m.id);
      const [counts, offers, balance] = await Promise.all([
        getCanonicalVoucherCounts(partnerIds, user?.id ?? null),
        getTopOffers(partnerIds, user?.id ?? null),
        getSignedInBalance(user?.id ?? null, user?.email ?? null),
      ]);
      initialMerchants = merchants.map((m) =>
        toMerchantValueSummary(m, offers[m.id], balance, q ?? null, counts[m.id] ?? 0)
      );
    }

    return (
      <main className="mx-auto max-w-7xl px-4 pt-3 pb-2 sm:px-6 sm:pt-8 sm:pb-4 lg:px-8">
        <div className="mb-3 sm:mb-8">
          <h1 className="font-sterling text-2xl font-semibold text-akiba-ink sm:text-3xl">Merchants</h1>
          <p className="mt-1 text-sm text-akiba-muted sm:mt-2 sm:text-base">
            Find places to earn and use AkibaMiles—near you and online.
          </p>
        </div>

        {initialMerchants.length === 0 && !q && !category && !city && !mode ? (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-akiba-line bg-white px-6 py-16 text-center">
            <Store className="mb-4 h-12 w-12 text-akiba-line" />
            <h2 className="font-sterling text-xl font-semibold text-akiba-ink">No merchants yet</h2>
            <p className="mt-2 max-w-xs text-sm text-akiba-muted">Partner merchants are being onboarded. Check back soon.</p>
          </div>
        ) : (
          <MerchantFilters
            initialMerchants={initialMerchants}
            initialNextCursor={next_cursor}
            categories={categories}
            cities={cities}
            initialFilters={{ q: q ?? "", category: category ?? "", city: city ?? "", mode: mode ?? "all" }}
          />
        )}
      </main>
    );
  } catch {
    return (
      <main className="mx-auto max-w-7xl px-4 pt-3 pb-2 sm:px-6 sm:pt-8 sm:pb-4 lg:px-8">
        <div className="mb-3 sm:mb-8">
          <h1 className="font-sterling text-2xl font-semibold text-akiba-ink sm:text-3xl">Merchants</h1>
        </div>
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-akiba-line bg-white px-6 py-16 text-center">
          <Store className="mb-4 h-12 w-12 text-akiba-line" />
          <h2 className="font-sterling text-xl font-semibold text-akiba-ink">Merchants are temporarily unavailable</h2>
          <p className="mt-2 max-w-xs text-sm text-akiba-muted">Something went wrong loading the directory. Please try again shortly.</p>
          <a
            href="/merchants"
            className="mt-4 rounded-full bg-akiba-teal px-5 py-2 text-sm font-semibold text-white"
          >
            Retry
          </a>
        </div>
      </main>
    );
  }
}
