import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://localhost:54321";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? "admin-dashboard-build-placeholder";

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.warn("[admin-dashboard] SUPABASE_URL or SUPABASE_SERVICE_KEY not set");
}

// Service-role client — only ever used in server components and API routes.
export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  global: {
    // Administrative reads must reflect current review and payment state,
    // including local open-access sessions that don't read a cookie.
    fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
  },
});
