import { supabase } from "@/lib/supabaseClient";

export async function isBlacklisted(address: string): Promise<boolean> {
  const { data } = await supabase
    .from("blacklisted_addresses")
    .select("address")
    .eq("address", address.toLowerCase())
    .maybeSingle();
  return !!data;
}
