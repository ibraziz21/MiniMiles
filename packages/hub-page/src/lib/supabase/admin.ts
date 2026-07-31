import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env.server";

// Service-role client — server-side ONLY, never import in client components
export function createAdminClient() {
  const env = getServerEnv();
  return createSupabaseClient(env.supabase.url, env.supabase.serviceKey);
}
