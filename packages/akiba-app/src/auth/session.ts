import type { Session } from '@supabase/supabase-js';

import { supabase } from './supabase';

export async function restoreSession(): Promise<Session | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw error;
  }
  return data.session;
}

/** The current Supabase access token, or null when there's no session — screens pass this straight into createApiClient. */
export async function getAccessToken(): Promise<string | null> {
  const session = await restoreSession();
  return session?.access_token ?? null;
}
