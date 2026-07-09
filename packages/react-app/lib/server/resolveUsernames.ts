// lib/server/resolveUsernames.ts
//
// Batch-resolve wallet addresses to display names using the `users` table.
// Falls back to a shortened address when no username is set.

import { supabase } from "@/lib/supabaseClient";

export function shortenAddress(addr: string): string {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * Returns a map of lowercased address → display label (username if present,
 * otherwise a shortened address). Never throws — on error, every address maps
 * to its shortened form.
 */
export async function resolveDisplayNames(
  addresses: string[],
): Promise<Record<string, string>> {
  const unique = [...new Set(addresses.map((a) => a.toLowerCase()).filter(Boolean))];
  const out: Record<string, string> = {};
  for (const a of unique) out[a] = shortenAddress(a);

  if (unique.length === 0) return out;

  try {
    const { data } = await supabase
      .from("users")
      .select("user_address, username")
      .in("user_address", unique);

    for (const row of data ?? []) {
      const addr = String(row.user_address).toLowerCase();
      if (row.username) out[addr] = row.username;
    }
  } catch {
    // keep shortened-address fallbacks
  }

  return out;
}

/** Resolve a single address to its display label. */
export async function resolveDisplayName(address: string): Promise<string> {
  const map = await resolveDisplayNames([address]);
  return map[address.toLowerCase()] ?? shortenAddress(address);
}
