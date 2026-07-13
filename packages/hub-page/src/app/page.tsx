import { createAdminClient } from "@/lib/supabase/admin";
import { ShoppingBag, Sparkles, Zap, ArrowRight, Coins } from "lucide-react";
import { HIDDEN_PARTNER_FILTER, isHiddenPartner } from "@/lib/akiba/hidden-partners";

async function getFeaturedMerchants() {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("partners")
      .select("id, slug, name, image_url, partner_settings!inner(store_active, logo_url)")
      .eq("partner_settings.store_active", true)
      .not("id", "in", HIDDEN_PARTNER_FILTER)
      .limit(4);
    return (data ?? []).map((p) => {
      const s = Array.isArray(p.partner_settings) ? p.partner_settings[0] : p.partner_settings;
      return { id: p.id, slug: p.slug, name: p.name, image_url: s?.logo_url ?? p.image_url };
    });
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const merchants = await getFeaturedMerchants();

  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      {/* Hero */}
      <section className="mb-14 text-center">
        <h1 className="font-sterling text-4xl font-semibold tracking-tight text-akiba-ink sm:text-5xl">
          Your rewards,{" "}
          <span className="text-akiba-teal">all in one place</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base text-akiba-muted">
          Shop from merchants, earn AkibaMiles, claim cross-chain rewards, and
          complete partner quests &mdash; no matter which ecosystem you&apos;re in.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <a
            href="/shop"
            className="inline-flex items-center gap-2 rounded-full bg-akiba-teal px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-[#1E7E8D]"
          >
            <ShoppingBag className="h-4 w-4" /> Start shopping
          </a>
          <a
            href="/rewards"
            className="inline-flex items-center gap-2 rounded-full border border-akiba-line bg-white px-6 py-2.5 text-sm font-semibold text-akiba-ink transition hover:border-akiba-teal/50"
          >
            <Sparkles className="h-4 w-4 text-akiba-teal" /> See rewards
          </a>
        </div>
      </section>

      {/* 3 section cards */}
      <section className="mb-14 grid gap-4 sm:grid-cols-3">
        <SectionCard
          href="/shop"
          icon={<ShoppingBag className="h-6 w-6" />}
          title="Shop & Earn"
          description="Buy from verified merchants using stablecoins or M-Pesa. Earn eligible AkibaMiles rewards after verified purchases."
          color="teal"
          cta="Browse merchants"
        />
        <SectionCard
          href="/rewards"
          icon={<Sparkles className="h-6 w-6" />}
          title="Rewards & Offers"
          description="Active campaigns on MiniPay, Base, Celo, and more. Claim points for on-chain actions."
          color="amber"
          cta="Claim rewards"
        />
        <SectionCard
          href="/quests"
          icon={<Zap className="h-6 w-6" />}
          title="Partner Quests"
          description="Complete tasks set by our partners and earn AkibaMiles for every verified quest."
          color="purple"
          cta="View quests"
        />
      </section>

      {/* Featured merchants preview */}
      {merchants.length > 0 && (
        <section className="mb-10">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-sterling text-xl font-semibold text-akiba-ink">
              Featured merchants
            </h2>
            <a
              href="/shop"
              className="flex items-center gap-1 text-sm font-semibold text-akiba-teal"
            >
              See all <ArrowRight className="h-3.5 w-3.5" />
            </a>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {merchants.map((m) => (
              <a
                key={m.id}
                href={`/shop/${m.slug}`}
                className="group flex flex-col items-center gap-3 rounded-2xl border border-akiba-line bg-white p-4 transition hover:border-akiba-teal/40 hover:shadow-chip"
              >
                <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl bg-akiba-card">
                  {m.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={m.image_url}
                      alt={m.name}
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <ShoppingBag className="h-6 w-6 text-akiba-muted" />
                  )}
                </div>
                <span className="text-center text-xs font-semibold text-akiba-ink group-hover:text-akiba-teal">
                  {m.name}
                </span>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* How miles work */}
      <section className="rounded-2xl bg-akiba-ink px-6 py-8 text-white sm:px-10">
        <h2 className="mb-6 font-sterling text-2xl font-semibold">
          How AkibaMiles work
        </h2>
        <div className="grid gap-6 sm:grid-cols-3">
          {[
            { step: "01", title: "Shop or complete quests", desc: "Buy from merchants or complete partner quests to earn miles." },
            { step: "02", title: "Earn AkibaMiles", desc: "Miles land in your wallet automatically after each verified action." },
            { step: "03", title: "Spend on vouchers", desc: "Redeem miles for vouchers that discount your next purchase." },
          ].map(({ step, title, desc }) => (
            <div key={step} className="flex gap-4">
              <span className="font-sterling text-2xl font-bold text-akiba-teal">{step}</span>
              <div>
                <p className="font-semibold text-white">{title}</p>
                <p className="mt-1 text-sm text-white/50">{desc}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-6 flex items-center gap-2 text-sm text-white/40">
          <Coins className="h-4 w-4" />
          <span>Miles are on-chain ERC-20 tokens on Celo Mainnet</span>
        </div>
      </section>
    </main>
  );
}

function SectionCard({
  href,
  icon,
  title,
  description,
  color,
  cta,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  color: "teal" | "amber" | "purple";
  cta: string;
}) {
  const bg = { teal: "bg-akiba-tint", amber: "bg-amber-50", purple: "bg-purple-50" }[color];
  const iconColor = { teal: "text-akiba-teal", amber: "text-amber-500", purple: "text-purple-500" }[color];
  const ctaColor = { teal: "text-akiba-teal", amber: "text-amber-600", purple: "text-purple-600" }[color];

  return (
    <a
      href={href}
      className="group flex flex-col rounded-2xl border border-akiba-line bg-white p-6 transition hover:border-current hover:shadow-soft"
    >
      <span className={`mb-4 flex h-12 w-12 items-center justify-center rounded-xl ${bg} ${iconColor}`}>
        {icon}
      </span>
      <h3 className="font-sterling text-lg font-semibold text-akiba-ink">{title}</h3>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-akiba-muted">{description}</p>
      <span className={`mt-4 flex items-center gap-1 text-sm font-semibold ${ctaColor}`}>
        {cta} <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
      </span>
    </a>
  );
}
