import { Beef, Wifi, Fuel, ShoppingBasket, Gamepad2, Smartphone, Coffee, Gift, Tag } from "lucide-react";
import { TrackedLink } from "@/components/akiba/TrackedLink";
import type { DiscoveryIntent } from "@/lib/home/types";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  beef: Beef,
  wifi: Wifi,
  fuel: Fuel,
  "shopping-basket": ShoppingBasket,
  "gamepad-2": Gamepad2,
  smartphone: Smartphone,
  coffee: Coffee,
  gift: Gift,
};

export function IntentShortcuts({ intents, title }: { intents: DiscoveryIntent[]; title: string }) {
  if (intents.length === 0) return null;

  return (
    <section className="mb-7 sm:mb-8">
      <h2 className="mb-3 font-sterling text-lg font-semibold text-akiba-ink sm:text-xl">{title}</h2>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-8 sm:gap-3">
        {intents.map((intent, i) => {
          const Icon = ICONS[intent.iconKey] ?? Tag;
          return (
            <TrackedLink
              key={intent.id}
              href={`/merchants?q=${encodeURIComponent(intent.query)}&intent=${intent.slug}&from=home_shortcut`}
              event="home_intent_tap"
              eventProps={{ intent_id: intent.id, position: i }}
              className="group flex min-h-[4.5rem] min-w-0 flex-col items-center justify-center gap-1.5 rounded-2xl border border-akiba-line bg-white px-1 py-2.5 text-center text-xs font-semibold leading-tight text-akiba-ink transition hover:-translate-y-0.5 hover:border-akiba-teal/40 hover:shadow-chip active:scale-[0.98] active:bg-akiba-tint/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal sm:min-h-24 sm:gap-2 sm:px-2 sm:py-3"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-akiba-tint text-akiba-teal transition group-hover:bg-akiba-teal group-hover:text-white sm:h-9 sm:w-9">
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="line-clamp-2">{intent.label}</span>
            </TrackedLink>
          );
        })}
      </div>
    </section>
  );
}
