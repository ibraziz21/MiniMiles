// Canonical country-name -> ISO-3166-1 alpha-2 mapping. CountryEditor.tsx
// writes hub_user_profiles.country as a plain display name from a fixed
// list; merchant data (partners.country) may already be ISO. Next Reward's
// country-match relevance signal (next-reward-progress-v1-spec.md §6.3/§6.4)
// must compare both sides the same way, and must never guess: "Other",
// blank and unrecognized values normalize to `null` ("unknown") rather than
// silently matching or mismatching.
const COUNTRY_NAME_TO_ISO: Record<string, string> = {
  kenya: "KE",
  uganda: "UG",
  tanzania: "TZ",
  nigeria: "NG",
  ghana: "GH",
  rwanda: "RW",
  "south africa": "ZA",
  zambia: "ZM",
  ethiopia: "ET",
};

export function normalizeCountry(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === "other") return null;
  if (/^[a-z]{2}$/i.test(trimmed)) return trimmed.toUpperCase();
  return COUNTRY_NAME_TO_ISO[trimmed.toLowerCase()] ?? null;
}
