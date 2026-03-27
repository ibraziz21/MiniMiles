// email and phone are collected but NOT counted toward completion —
// they cannot be verified so counting them enables trivial farming.
export const PROFILE_FIELDS = [
  "username",
  "full_name",
  "twitter_handle",
  "bio",
  "interests",
] as const;

export function computeCompletion(row: Record<string, any>): number {
  let filled = 0;
  for (const f of PROFILE_FIELDS) {
    const v = row[f];
    if (f === "interests") {
      if (Array.isArray(v) && v.some((i: any) => String(i).trim().length >= 2)) filled++;
    } else if (f === "bio") {
      if (v && String(v).trim().length >= 20) filled++;
    } else if (f === "twitter_handle") {
      if (v && /^@?[A-Za-z0-9_]{4,15}$/.test(String(v).trim())) filled++;
    } else if (f === "full_name") {
      if (v && String(v).trim().length >= 3) filled++;
    } else {
      // username
      if (v && String(v).trim()) filled++;
    }
  }
  return Math.round((filled / PROFILE_FIELDS.length) * 100);
}
