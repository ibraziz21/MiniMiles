import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ actor: 'member-a' as string | null, activity: vi.fn(), places: vi.fn(), profile: vi.fn() }));
vi.mock('@/lib/auth/requestActor', () => {
  class UnauthorizedError extends Error { code = 'UNAUTHORIZED'; status = 401; }
  return { UnauthorizedError, requireActor: async () => { if (!state.actor) throw new UnauthorizedError('Sign in'); return { userId: state.actor, email: 'member@example.com' }; } };
});
vi.mock('@/lib/akiba/hubProfile', () => ({ resolveHubProfile: state.profile }));
vi.mock('@/lib/akiba/activity', () => ({ getRecentActivity: state.activity }));
vi.mock('@/lib/merchants/savedMerchants', () => ({ listSavedMerchants: state.places }));
const activityRoute = await import('@/app/api/v1/me/activity/route');
const placesRoute = await import('@/app/api/v1/me/saved-places/route');
const req = (query = '') => new Request(`http://localhost/api/v1/me/test${query}`);
beforeEach(() => { vi.clearAllMocks(); state.actor = 'member-a'; state.profile.mockResolvedValue({ walletAddress: null }); state.activity.mockResolvedValue([]); state.places.mockResolvedValue([]); });
describe('profile account collections', () => {
  it('requires authentication before reading either collection', async () => {
    state.actor = null;
    expect((await activityRoute.GET(req())).status).toBe(401);
    expect((await placesRoute.GET(req())).status).toBe(401);
    expect(state.activity).not.toHaveBeenCalled(); expect(state.places).not.toHaveBeenCalled();
  });
  it('reads history with the actor identity and strict source failures', async () => {
    const response = await activityRoute.GET(req());
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(state.activity).toHaveBeenCalledWith({ userId: 'member-a', email: 'member@example.com', walletAddress: null, limit: 100, strict: true });
  });
  it('does not disguise a failed activity read as empty history or expose database errors', async () => {
    state.activity.mockRejectedValue(new Error('secret database diagnostics'));
    const response = await activityRoute.GET(req());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('secret database');
  });
  it('paginates saved places within the current account', async () => {
    state.places.mockResolvedValue(Array.from({ length: 21 }, (_, index) => ({ id: String(index) })));
    const response = await placesRoute.GET(req('?offset=20'));
    const body = await response.json();
    expect(body.data.places).toHaveLength(20);
    expect(body.data.nextOffset).toBe(40);
    expect(state.places).toHaveBeenCalledWith('member-a', { strict: true, offset: 20, limit: 21 });
  });
  it('rejects invalid pagination and reports a read failure', async () => {
    expect((await placesRoute.GET(req('?offset=-1'))).status).toBe(400);
    expect(state.places).not.toHaveBeenCalled();
    state.places.mockRejectedValue(new Error('unavailable'));
    expect((await placesRoute.GET(req())).status).toBe(503);
  });
});
