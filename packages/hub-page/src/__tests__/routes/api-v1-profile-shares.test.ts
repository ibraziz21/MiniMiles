import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ actor: 'member-a' as string | null, enabled: true, calls: [] as { table: string; method: string; args: unknown[] }[], results: {} as Record<string, { data: unknown[]; error: unknown }>, sign: vi.fn() }));
vi.mock('@/lib/auth/requestActor', () => {
  class UnauthorizedError extends Error { code = 'UNAUTHORIZED'; status = 401; }
  return { UnauthorizedError, requireActor: async () => { if (!state.actor) throw new UnauthorizedError('Sign in'); return { userId: state.actor }; } };
});
vi.mock('@/lib/akiba/discoveryContributionsRollout', () => ({ isDiscoveryContributionsEnabledFor: () => state.enabled }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({
  from(table: string) {
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'is', 'order', 'range', 'limit', 'in', 'gt']) chain[method] = (...args: unknown[]) => { state.calls.push({ table, method, args }); return chain; };
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(state.results[table] ?? { data: [], error: null }).then(resolve);
    return chain;
  }, storage: { from: () => ({ createSignedUrls: state.sign }) },
}) }));
const { GET } = await import('@/app/api/v1/me/community-shares/route');
const req = (suffix = '') => new Request(`http://localhost/api/v1/me/community-shares${suffix}`);
beforeEach(() => { vi.clearAllMocks(); state.actor = 'member-a'; state.enabled = true; state.calls = []; state.results = {}; state.sign.mockResolvedValue({ data: [{ path: 'derived/photo.webp', signedUrl: 'https://example.com/photo' }], error: null }); });
describe('private profile community shares', () => {
  it('never reads personal contributions for an anonymous request', async () => {
    state.actor = null;
    expect((await GET(req())).status).toBe(401); expect(state.calls).toEqual([]);
  });
  it('scopes contributions, opportunities, photo ownership and raw item labels to the actor', async () => {
    state.results.merchant_discovery_contributions = { data: [{ id: 'share-a', request_id: 'request-a', submitted_at: '2026-11-10T08:00:00Z', would_recommend: false, experience_option_ids: ['quiet'], partners: { name: 'Cafe', slug: 'cafe', image_url: null }, discovery_contribution_requests: { template_snapshot: { experience_options: [{ id: 'quiet', publicLabel: 'Quiet morning' }] } } }], error: null };
    state.results.merchant_visit_photos = { data: [{ id: 'photo-a', contribution_id: 'share-a', moderation_status: 'pending', thumbnail_key: 'derived/photo.webp' }], error: null };
    state.results.merchant_discovery_contribution_items = { data: [{ contribution_id: 'share-a', merchant_discovery_item_mentions: { raw_label: 'Coffee', hub_user_id: 'member-a' } }], error: null };
    const response = await GET(req()); const body = await response.json();
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(body.data.shares[0]).toMatchObject({ recommendation: 'not_recommended', publiclyVisible: false, experienceLabels: ['Quiet morning'], items: ['Coffee'], photoState: 'under_review', photos: [{ id: 'photo-a', url: 'https://example.com/photo', status: 'pending' }] });
    for (const table of ['merchant_discovery_contributions', 'discovery_contribution_requests', 'merchant_visit_photos']) expect(state.calls).toContainEqual({ table, method: 'eq', args: ['hub_user_id', 'member-a'] });
    expect(state.calls).toContainEqual({ table: 'merchant_discovery_contribution_items', method: 'eq', args: ['merchant_discovery_item_mentions.hub_user_id', 'member-a'] });
    expect(state.sign).toHaveBeenCalledWith(['derived/photo.webp'], 300);
    expect(JSON.stringify(body)).not.toContain('hub_user_id');
  });
  it('does not turn a failed private read into an empty collection', async () => {
    state.results.merchant_discovery_contributions = { data: [], error: { message: 'private database failure' } };
    const response = await GET(req()); expect(response.status).toBe(503); expect(await response.text()).not.toContain('private database');
  });
  it('respects the contribution rollout and rejects invalid pagination', async () => {
    expect((await GET(req('?offset=nope'))).status).toBe(400);
    state.enabled = false;
    expect((await GET(req())).status).toBe(200);
    expect(state.calls.some(call => call.table === 'discovery_contribution_requests')).toBe(false);
  });
});
