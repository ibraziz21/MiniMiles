"use client";

import { useState, useMemo } from "react";
import { Search, ShoppingBag, Tag, MapPin, X } from "lucide-react";
import clsx from "clsx";
import { MilesAmount } from "@/components/MilesIcon";

type Merchant = {
  id: string;
  slug: string;
  name: string;
  country: string;
  image_url: string | null;
  delivery_cities: string[];
  product_count: number;
  voucher_count: number;
  categories: string[];
};

const CATEGORY_LABELS: Record<string, string> = {
  electronics: "Electronics", accessories: "Accessories", services: "Services",
  clothing: "Clothing", food: "Food & Drinks", general: "General",
};

export function ShopFilters({ merchants }: { merchants: Merchant[] }) {
  const [search, setSearch] = useState("");
  const [country, setCountry] = useState("");
  const [category, setCategory] = useState("");

  const countries = useMemo(
    () => [...new Set(merchants.map((m) => m.country).filter(Boolean))].sort(),
    [merchants]
  );
  const categories = useMemo(
    () => [...new Set(merchants.flatMap((m) => m.categories))].sort(),
    [merchants]
  );

  const filtered = useMemo(() => {
    return merchants.filter((m) => {
      if (search && !m.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (country && m.country !== country) return false;
      if (category && !m.categories.includes(category)) return false;
      return true;
    });
  }, [merchants, search, country, category]);

  const hasFilter = search || country || category;

  return (
    <div>
      {/* Search + filter bar */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-akiba-muted" />
          <input
            type="text"
            placeholder="Search merchants…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-akiba-line bg-white py-2.5 pl-9 pr-4 text-sm outline-none focus:border-akiba-teal"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-2.5 text-akiba-muted hover:text-akiba-ink">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Country chips */}
      {countries.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-2">
          <FilterChip label="All countries" icon={<MapPin className="h-3 w-3" />} active={!country} onClick={() => setCountry("")} />
          {countries.map((c) => (
            <FilterChip key={c} label={c} icon={<MapPin className="h-3 w-3" />} active={country === c} onClick={() => setCountry(country === c ? "" : c)} />
          ))}
        </div>
      )}

      {/* Category chips */}
      {categories.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          <FilterChip label="All categories" icon={<ShoppingBag className="h-3 w-3" />} active={!category} onClick={() => setCategory("")} />
          {categories.map((c) => (
            <FilterChip key={c} label={CATEGORY_LABELS[c] ?? c} icon={<Tag className="h-3 w-3" />} active={category === c} onClick={() => setCategory(category === c ? "" : c)} />
          ))}
        </div>
      )}

      {/* Results */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-akiba-line bg-white py-14 text-center">
          <ShoppingBag className="mb-3 h-10 w-10 text-akiba-line" />
          <p className="font-medium text-akiba-ink">No merchants match</p>
          {hasFilter && (
            <button onClick={() => { setSearch(""); setCountry(""); setCategory(""); }}
              className="mt-3 text-sm font-semibold text-akiba-teal">
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((m) => (
            <MerchantCard key={m.id} merchant={m} />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterChip({ label, icon, active, onClick }: { label: string; icon: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition",
        active
          ? "border-akiba-teal bg-akiba-teal text-white"
          : "border-akiba-line bg-white text-akiba-muted hover:border-akiba-teal/40 hover:text-akiba-ink"
      )}
    >
      {icon} {label}
    </button>
  );
}

function MerchantCard({ merchant: m }: { merchant: Merchant }) {
  const cities = m.delivery_cities.slice(0, 3);
  const extra = m.delivery_cities.length - 3;

  return (
    <a href={`/shop/${m.slug}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-akiba-line bg-white transition hover:border-akiba-teal/40 hover:shadow-soft">
      <div className="flex h-36 items-center justify-center bg-akiba-card">
        {m.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={m.image_url} alt={m.name} className="max-h-24 max-w-[60%] object-contain transition group-hover:scale-105" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-akiba-teal/10">
            <ShoppingBag className="h-8 w-8 text-akiba-teal" />
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="mb-2 flex items-start justify-between gap-2">
          <h2 className="font-semibold text-akiba-ink group-hover:text-akiba-teal">{m.name}</h2>
          <span className="shrink-0 rounded-full bg-akiba-card px-2 py-0.5 text-[11px] font-medium text-akiba-muted">{m.country}</span>
        </div>
        <div className="flex gap-3 text-xs text-akiba-muted">
          {m.product_count > 0 && <span className="flex items-center gap-1"><ShoppingBag className="h-3 w-3" />{m.product_count} items</span>}
          {m.voucher_count > 0 && <span className="flex items-center gap-1 text-akiba-teal"><Tag className="h-3 w-3" />{m.voucher_count} vouchers</span>}
        </div>
        {cities.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {cities.map((c) => <span key={c} className="flex items-center gap-0.5 rounded-full bg-akiba-card px-2 py-0.5 text-[11px] text-akiba-muted"><MapPin className="h-2.5 w-2.5" />{c}</span>)}
            {extra > 0 && <span className="rounded-full bg-akiba-card px-2 py-0.5 text-[11px] text-akiba-muted">+{extra} more</span>}
          </div>
        )}
        <div className="mt-4 flex items-center justify-between">
          <MilesAmount amount={200} size="xs" prefix="+" className="rounded-full bg-akiba-tint px-3 py-1 text-akiba-teal" />
          <span className="text-xs font-semibold text-akiba-teal group-hover:underline">Shop →</span>
        </div>
      </div>
    </a>
  );
}
