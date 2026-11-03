import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  user: { id: 'member', email: 'member@example.com' } as { id: string; email: string } | null,
  pass: { onboarding_required: true, onboarding_seen_at: null as string | null },
  error: null as object | null,
  passId: 'pass' as string | null,
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.pass, error: state.error }) }) }) }) }) }));
vi.mock('@/lib/akiba/hubProfile', () => ({ resolveHubProfile: async () => ({ walletAddress: null }) }));
vi.mock('@/lib/akiba/pass', () => ({ getOrCreatePass: async () => ({ publicPassId: state.passId }) }));
import { GET } from '@/app/auth/continue/route';

describe('post-signin onboarding routing', () => {
  beforeEach(() => {
    state.user = { id: 'member', email: 'member@example.com' };
    state.pass = { onboarding_required: true, onboarding_seen_at: null };
    state.error = null; state.passId = 'pass';
  });
  const request = () => new Request('https://pass.example/auth/continue?next=%2Fmerchants%2Fcafe%3Foffer%3D1');
  it('takes a new member to welcome and retains their destination', async () => {
    const response = await GET(request());
    const target = new URL(response.headers.get('location')!);
    expect(target.pathname).toBe('/welcome');
    expect(target.searchParams.get('next')).toBe('/merchants/cafe?offer=1');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it('lets existing Pass holders continue without forcing onboarding', async () => {
    state.pass.onboarding_required = false;
    expect((await GET(request())).headers.get('location')).toBe('https://pass.example/merchants/cafe?offer=1');
  });
  it('honours onboarding completed in the native app', async () => {
    state.pass.onboarding_seen_at = '2026-11-03';
    expect((await GET(request())).headers.get('location')).toBe('https://pass.example/merchants/cafe?offer=1');
  });
  it('requires sign-in before loading member data', async () => {
    state.user = null;
    expect(new URL((await GET(request())).headers.get('location')!).pathname).toBe('/login');
  });
  it('does not silently bypass onboarding when progress cannot be loaded', async () => {
    state.error = { message: 'offline' };
    expect((await GET(request())).status).toBe(503);
  });
  it('does not redirect into a loop if Pass creation fails', async () => {
    state.passId = null;
    expect((await GET(request())).status).toBe(503);
  });
});
