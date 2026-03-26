import { supabase } from "@/lib/supabaseClient";

export async function isBlacklisted(address: string, route?: string): Promise<boolean> {
  const addr = address.toLowerCase();

  const { data } = await supabase
    .from("blacklisted_addresses")
    .select("address")
    .eq("address", addr)
    .maybeSingle();

  if (data) {
    console.warn(`[blacklist] Blocked attempt — address: ${addr} route: ${route ?? "unknown"}`);

    // Fire-and-forget: log to blacklist_hits table (non-blocking)
    supabase
      .from("blacklist_hits")
      .insert({ address: addr, route: route ?? null })
      .then(({ error }) => {
        if (error) console.error("[blacklist] Failed to log hit:", error.message);
      });
  }

  return !!data;
}
