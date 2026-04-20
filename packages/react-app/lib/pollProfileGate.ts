// lib/pollProfileGate.ts
// Checks whether a wallet's profile meets the minimum completion threshold
// required by a poll.
//
// Thresholds (stored in polls.min_profile_pct):
//   0   — no profile gate (informational polls, zero-point polls)
//   50  — standard reward-bearing survey (default)
//   100 — premium / partner-facing surveys
//
// The "minimum viable profile" for segmentability:
//   username + country + at least one interest (= 3 of 5 scored fields = 60%)
// We express this as a numeric threshold so it's data-driven per poll.

import { supabase } from "@/lib/supabaseClient";
import { computeCompletion, PROFILE_FIELDS } from "@/lib/profileCompletion";

export type ProfileGateResult =
  | { ok: true; completionPct: number }
  | { ok: false; completionPct: number; missing: string[] };

/**
 * Returns whether the wallet meets the poll's minimum profile completion.
 * Pass `minPct = 0` to skip the gate entirely.
 */
export async function checkPollProfileGate(
  walletAddress: string,
  minPct: number
): Promise<ProfileGateResult> {
  if (minPct <= 0) return { ok: true, completionPct: 100 };

  const addr = walletAddress.toLowerCase();

  const { data, error } = await supabase
    .from("users")
    .select("username, full_name, twitter_handle, bio, interests")
    .eq("user_address", addr)
    .maybeSingle();

  if (error) {
    // Degrade gracefully on DB error — don't block the user
    console.error("[pollProfileGate] DB error", error);
    return { ok: true, completionPct: 0 };
  }

  const row = data ?? {};
  const completionPct = computeCompletion(row);

  if (completionPct >= minPct) {
    return { ok: true, completionPct };
  }

  // Build a human-readable list of what's missing
  const missing: string[] = [];
  for (const f of PROFILE_FIELDS) {
    const v = row[f as keyof typeof row];
    let filled = false;
    if (f === "interests") {
      filled = Array.isArray(v) && (v as string[]).some((i) => String(i).trim().length >= 2);
    } else if (f === "bio") {
      filled = !!v && String(v).trim().length >= 20;
    } else if (f === "twitter_handle") {
      filled = !!v && /^@?[A-Za-z0-9_]{4,15}$/.test(String(v).trim());
    } else if (f === "full_name") {
      filled = !!v && String(v).trim().length >= 3;
    } else {
      filled = !!v && String(v).trim().length > 0;
    }
    if (!filled) {
      const labels: Record<string, string> = {
        username: "username",
        full_name: "full name",
        twitter_handle: "Twitter / X handle",
        bio: "bio",
        interests: "interests",
      };
      missing.push(labels[f] ?? f);
    }
  }

  return { ok: false, completionPct, missing };
}
