import type { DiscoveryIntent } from "./types";

/**
 * Statically configured "Browse by need" shortcuts (spec §6.2). Not
 * DB-backed in Phase 1 — an admin-editable table is a later-phase concern.
 * `categorySlug` is carried for future ranking/labelling use only; it is
 * deliberately NOT sent as a filter alongside `query` when a shortcut is
 * tapped, since the directory search ANDs `q`/`category` together and a
 * missing category assignment on an otherwise-matching merchant would
 * zero-result the shortcut.
 */
export const DISCOVERY_INTENTS: DiscoveryIntent[] = [
  { id: "burgers", slug: "burgers", label: "Burgers", iconKey: "beef", query: "burger", categorySlug: "food_drink", active: true, sortOrder: 1 },
  { id: "internet", slug: "internet", label: "Internet", iconKey: "wifi", query: "internet", active: true, sortOrder: 2 },
  { id: "fuel", slug: "fuel", label: "Fuel", iconKey: "fuel", query: "fuel", categorySlug: "automotive_mobility", active: true, sortOrder: 3 },
  { id: "groceries", slug: "groceries", label: "Groceries", iconKey: "shopping-basket", query: "groceries", categorySlug: "groceries_everyday", active: true, sortOrder: 4 },
  { id: "gaming", slug: "gaming", label: "Gaming", iconKey: "gamepad-2", query: "gaming", categorySlug: "entertainment_leisure", active: true, sortOrder: 5 },
  { id: "airtime", slug: "airtime", label: "Airtime", iconKey: "smartphone", query: "airtime", active: true, sortOrder: 6 },
  { id: "coffee", slug: "coffee", label: "Coffee", iconKey: "coffee", query: "coffee", categorySlug: "food_drink", active: true, sortOrder: 7 },
  { id: "gift_cards", slug: "gift_cards", label: "Gift Cards", iconKey: "gift", query: "gift cards", active: true, sortOrder: 8 },
];

export function getActiveIntents(): DiscoveryIntent[] {
  const now = Date.now();
  return DISCOVERY_INTENTS.filter((i) => {
    if (!i.active) return false;
    if (i.startsAt && new Date(i.startsAt).getTime() > now) return false;
    if (i.endsAt && new Date(i.endsAt).getTime() < now) return false;
    return true;
  }).sort((a, b) => a.sortOrder - b.sortOrder);
}

export function getIntentBySlug(slug: string | null | undefined): DiscoveryIntent | null {
  if (!slug) return null;
  return DISCOVERY_INTENTS.find((i) => i.slug === slug) ?? null;
}
