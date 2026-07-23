import { ShoppingBag } from "lucide-react";
import type { FeaturedMerchant } from "@/lib/akiba/featuredMerchants";
import { HomeViewTracker } from "@/components/akiba/HomeViewTracker";

// The slim pitch for logged-out visitors — home-redesign-spec.md §3. One
// screen, one CTA. Explainer content (three section cards, "How it works")
// moved to /welcome's onboarding carousel — visitors see it there, right
// after signup, not on every visit to home.
export function VisitorLanding({ merchants }: { merchants: FeaturedMerchant[] }) {
  return (
    <main className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-2xl flex-col justify-center px-4 py-10 text-center sm:px-6">
      <HomeViewTracker variant="visitor" />
      <h1 className="font-sterling text-4xl font-semibold tracking-tight text-akiba-ink sm:text-5xl">
        Everyday rewards from the shops you love.
      </h1>
      <p className="mx-auto mt-4 max-w-md text-base text-akiba-muted">
        Save with vouchers, discounts and offers — earn AkibaMiles through
        purchases, challenges and games.
      </p>

      <div className="mt-7 flex justify-center">
        <a
          href="/login?next=/welcome"
          className="inline-flex items-center gap-2 rounded-full bg-akiba-teal px-7 py-3 text-sm font-semibold text-white transition hover:bg-[#1E7E8D]"
        >
          Get your free Akiba Pass
        </a>
      </div>

      {merchants.length > 0 && (
        <section className="mt-12">
          <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-akiba-muted">
            Shop from merchants like
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {merchants.map((m) => (
              <div
                key={m.id}
                className="flex flex-col items-center gap-3 rounded-2xl border border-akiba-line bg-white p-4"
              >
                <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl bg-akiba-card">
                  {m.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.image_url} alt={m.name} className="h-full w-full object-contain" />
                  ) : (
                    <ShoppingBag className="h-6 w-6 text-akiba-muted" />
                  )}
                </div>
                <span className="text-center text-xs font-semibold text-akiba-ink">{m.name}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
