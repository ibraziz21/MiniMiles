import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role client — server-side ONLY, never import in client components
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );
}
