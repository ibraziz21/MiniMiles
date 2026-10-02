// Shared by lib/home/verifiedDiscovery.ts and lib/merchants/queries.ts —
// resolving a contribution's selected experience_option_ids against its
// template_snapshot to the public-safe labels a member actually saw and
// picked is the same operation in both places (hardening spec P2
// "maintainability cleanup: duplicated projection logic split behind tested
// domain interfaces"). Pulling it out once also means the 80-char
// truncation and the public/raw field boundary (inputLabel never leaves
// this function) can't drift between the two call sites.
function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * Returns the template-owned `publicLabel` strings for every
 * `experience_option_ids` entry that matches an option in `templateSnapshot`.
 * Unrecognized ids, missing labels and non-string/empty labels are silently
 * dropped rather than surfaced — the caller only ever gets public-safe
 * strings or nothing. `limit` caps how many are returned (by template
 * order, not popularity — callers that rank by frequency across many
 * contributions should not pass a limit here and cap after aggregating).
 */
export function extractPublicExperienceLabels(
  templateSnapshot: unknown,
  selectedOptionIds: unknown,
  limit?: number,
): string[] {
  const template = asRecord(templateSnapshot);
  if (!template) return [];

  const selected = new Set(
    Array.isArray(selectedOptionIds)
      ? selectedOptionIds.filter((id): id is string => typeof id === "string")
      : [],
  );
  const options = Array.isArray(template.experience_options) ? template.experience_options : [];
  const labels = options.flatMap((option) => {
    const value = asRecord(option);
    if (!value || typeof value.id !== "string" || !selected.has(value.id)) return [];
    if (typeof value.publicLabel !== "string") return [];
    const label = value.publicLabel.trim().slice(0, 80);
    return label ? [label] : [];
  });
  return typeof limit === "number" ? labels.slice(0, limit) : labels;
}
