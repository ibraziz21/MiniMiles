import { createClient as createSupabaseClient } from '@supabase/supabase-js';

const supabasePublic = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_SERVICE_KEY!
);

export async function fetchTotalCompletedChallenges(user: string): Promise<number> {
  const { count: dailyCount } = await supabasePublic
    .from('daily_engagements')
    .select('*', { count: 'exact', head: true })
    .eq('user_address', user);
  const { count: partnerCount } = await supabasePublic
    .from('partner_engagements')
    .select('*', { count: 'exact', head: true })
    .eq('user_address', user);
  return (dailyCount || 0) + (partnerCount || 0);
}