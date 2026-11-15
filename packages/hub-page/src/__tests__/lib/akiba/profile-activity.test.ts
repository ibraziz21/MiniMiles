import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ fail: false }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from(table: string) {
  let redemption = false;
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'or', 'eq', 'neq', 'limit', 'in', 'not']) chain[method] = () => chain;
  chain.order = (column: string) => { if (column === 'redeemed_at') redemption = true; return chain; };
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({
    data: table === 'issued_vouchers' && redemption ? [{ id: 'old-voucher', created_at: '2025-01-01T00:00:00Z', redeemed_at: '2026-11-10T12:00:00Z', acquisition_source: 'merchant_grant', sponsor: null, spend_voucher_templates: { title: 'Coffee', partners: { name: 'Cafe' } } }] : [],
    error: state.fail && table === 'issued_vouchers' ? { message: 'unavailable' } : null,
  }).then(resolve);
  return chain;
} }) }));
const { getRecentActivity } = await import('@/lib/akiba/activity');
beforeEach(() => { state.fail = false; });
describe('profile recent activity sources', () => {
  it('includes a recent redemption even when the voucher was issued outside the issue window', async () => {
    const items = await getRecentActivity({ userId: 'member', walletAddress: null, limit: 1, strict: true });
    expect(items).toEqual([expect.objectContaining({ id: 'vredeem-old-voucher', title: 'Redeemed “Coffee”', ts: Date.parse('2026-11-10T12:00:00Z') })]);
  });
  it('throws on a source failure for profile history while retaining legacy overview fallback', async () => {
    state.fail = true;
    await expect(getRecentActivity({ userId: 'member', walletAddress: null, strict: true })).rejects.toThrow('Activity sources unavailable');
    await expect(getRecentActivity({ userId: 'member', walletAddress: null })).resolves.toEqual([]);
  });
});
