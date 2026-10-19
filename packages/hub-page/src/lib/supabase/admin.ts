import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env.server";

type AdminClientOptions = {
  noStore?: boolean;
};

// Service-role client — server-side ONLY, never import in client components
export function createAdminClient(options: AdminClientOptions = {}) {
  const env = getServerEnv();
  return createSupabaseClient(
    env.supabase.url,
    env.supabase.serviceKey,
    options.noStore
      ? {
          global: {
            // Signed Storage URLs must be minted on every request. Next's
            // server fetch cache can otherwise retain the signing response
            // beyond the URL's own expiry even when the outer API route is
            // private/no-store.
            fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
          },
        }
      : undefined,
  );
}
