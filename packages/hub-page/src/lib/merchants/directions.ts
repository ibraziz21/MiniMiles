import type { PublicMerchantLocation } from "./types";

const ALLOWED_MAPS_HOSTS = ["maps.google.com", "www.google.com", "goo.gl", "maps.app.goo.gl"];

function isSafeMapsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && ALLOWED_MAPS_HOSTS.some((h) => parsed.hostname === h);
  } catch {
    return false;
  }
}

export function formatAddress(location: PublicMerchantLocation): string {
  const parts = [
    location.addressLine1,
    location.addressLine2,
    location.building,
    location.locality,
    location.city,
    location.countyOrRegion,
  ].filter(Boolean);
  return parts.join(", ");
}

/**
 * Street line only — no city, region or country.
 *
 * `formatAddress` above is the one-line display form and includes the city;
 * this is for contexts that carry locality, region and country as their own
 * fields (schema.org PostalAddress, the public directory contract), where
 * repeating the city reads as a duplicated address.
 */
export function formatStreetAddress(location: PublicMerchantLocation): string {
  return [
    location.addressLine1,
    location.addressLine2,
    location.building,
    location.floorOrUnit,
    location.locality,
  ]
    .filter(Boolean)
    .join(", ");
}

/** Directions target, preferring a verified maps URL, then coordinates, then the formatted address. */
export function buildDirectionsUrl(location: PublicMerchantLocation): string {
  if (location.mapsUrl && isSafeMapsUrl(location.mapsUrl)) return location.mapsUrl;
  if (location.latitude != null && location.longitude != null) {
    return `https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(formatAddress(location))}`;
}
