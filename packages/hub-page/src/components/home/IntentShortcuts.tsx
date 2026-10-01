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
    <section className="mb-5 sm:mb-6">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-akiba-muted sm:text-sm">{title}</h2>
      <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {intents.map((intent, i) => {
          const Icon = ICONS[intent.iconKey] ?? Tag;
          return (
            <TrackedLink
              key={intent.id}
              href={`/merchants?q=${encodeURIComponent(intent.query)}&intent=${intent.slug}&from=home_shortcut`}
              event="home_intent_tap"
              eventProps={{ intent_id: intent.id, position: i }}
              className="group flex min-h-11 shrink-0 snap-start items-center gap-2 rounded-full border border-akiba-line bg-white py-1.5 pl-1.5 pr-3.5 text-xs font-semibold leading-tight text-akiba-ink transition hover:border-akiba-teal/40 hover:shadow-chip active:scale-[0.98] active:bg-akiba-tint/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal sm:text-sm"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-akiba-tint text-akiba-teal transition group-hover:bg-akiba-teal group-hover:text-white">
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="whitespace-nowrap">{intent.label}</span>
            </TrackedLink>
          );
        })}
      </div>
    </section>
  );
}
