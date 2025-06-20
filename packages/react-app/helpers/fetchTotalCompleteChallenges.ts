import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function fetchTotalCompletedChallenges(user: string): Promise<number> {
  const address = user.toLowerCase();

  const { count: dailyCount, error: dailyError } = await supabase
    .from('daily_engagements')
    .select('*', { count: 'exact', head: true })
    .eq('user_address', address);

  const { count: partnerCount, error: partnerError } = await supabase
    .from('partner_engagements')
    .select('*', { count: 'exact', head: true })
    .eq('user_address', address);

  if (dailyError || partnerError) {
    console.error("Error fetching challenge completions", { dailyError, partnerError });
    return 0;
  }

  return (dailyCount || 0) + (partnerCount || 0);
}
