import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveHubProfile } from '@/lib/akiba/hubProfile';
import { getOrCreatePass } from '@/lib/akiba/pass';
import { needsWebOnboarding, onboardingReturnPath } from '@/lib/akiba/webOnboarding';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = onboardingReturnPath(url.searchParams.get('next'));
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(next)}`, url.origin));

  const { walletAddress } = await resolveHubProfile({ userId: user.id, email: user.email ?? null });
  const { publicPassId } = await getOrCreatePass({ userId: user.id, email: user.email ?? null, walletAddress });
  if (!publicPassId) return NextResponse.json({ error: 'Could not prepare your Pass. Please try again.' }, { status: 503 });
  const { data, error } = await createAdminClient().from('hub_user_passes')
    .select('onboarding_required, onboarding_seen_at').eq('user_id', user.id).maybeSingle();
  if (error || !data) return NextResponse.json({ error: 'Could not load your progress. Please try again.' }, { status: 503 });
  const destination = needsWebOnboarding(data) ? `/welcome?next=${encodeURIComponent(next)}` : next;
  const response = NextResponse.redirect(new URL(destination, url.origin));
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
