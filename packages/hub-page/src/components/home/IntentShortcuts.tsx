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
    <section className="mb-4">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-akiba-muted">{title}</h2>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {intents.map((intent, i) => {
          const Icon = ICONS[intent.iconKey] ?? Tag;
          return (
            <TrackedLink
              key={intent.id}
              href={`/merchants?q=${encodeURIComponent(intent.query)}&intent=${intent.slug}&from=home_shortcut`}
              event="home_intent_tap"
              eventProps={{ intent_id: intent.id, position: i }}
              className="flex shrink-0 items-center gap-2 rounded-full border border-akiba-line bg-white px-3.5 py-2 text-sm font-medium text-akiba-ink transition hover:border-akiba-teal/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
            >
              <Icon className="h-4 w-4 text-akiba-teal" /> {intent.label}
            </TrackedLink>
          );
        })}
      </div>
    </section>
  );
}
