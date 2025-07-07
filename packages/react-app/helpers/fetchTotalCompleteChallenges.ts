import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_SERVICE_KEY!
);

export async function fetchTotalCompletedChallenges(user: string): Promise<number> {


  const { count: dailyCount, error: dailyError } = await supabase
    .from('daily_engagements')
    .select('*', { count: 'exact', head: true })
    .eq('user_address', user);

  const { count: partnerCount, error: partnerError } = await supabase
    .from('partner_engagements')
    .select('*', { count: 'exact', head: true })
    .eq('user_address', user);

  if (dailyError || partnerError) {
    console.error("Error fetching challenge completions", { dailyError, partnerError });
    return 0;
  }

  return (dailyCount || 0) + (partnerCount || 0);
}
