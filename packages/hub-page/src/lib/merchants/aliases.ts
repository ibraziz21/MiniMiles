/**
 * Controlled search aliases (spec home-redesign-spec.md §8.1) — reviewed
 * configuration, not arbitrary merchant-supplied keyword stuffing. Matched
 * against the whole trimmed/lowercased query, never a partial substring
 * replace, so a multi-word phrase containing an alias token isn't silently
 * rewritten.
 */
const QUERY_ALIASES: Record<string, string> = {
  wifi: "internet",
  bundles: "internet",
  data: "internet",
  petrol: "fuel",
  diesel: "fuel",
  salon: "beauty",
  braids: "beauty",
  "nyama choma": "grill",
};

export function expandQueryAlias(q: string): string {
  const key = q.trim().toLowerCase();
  return QUERY_ALIASES[key] ?? q;
}
