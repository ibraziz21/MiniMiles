import { describe, expect, it, vi } from 'vitest';
import { createVoucherPresentationController, type PresentationView } from '@/lib/voucher-presentation';
import { getScreenshotVoucherDetail } from '@/fixtures/screenshot-commerce';
import type { VoucherPresentation } from '@/contracts/owned-vouchers';
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const data = (): VoucherPresentation => ({ token: 'sample', expires_at: new Date(Date.now() + 60000).toISOString(), entitlement: getScreenshotVoucherDetail('screenshot-voucher-free-coffee').entitlement! });
describe('voucher QR lifecycle', () => {
  it('does not revoke another presentation if this screen never opened one', async () => {
    const revoke = vi.fn(async () => {});
    const c = createVoucherPresentationController({ issue: vi.fn(), revoke }, vi.fn());
    c.close(); await tick(); expect(revoke).not.toHaveBeenCalled();
  });
  it('does not mint twice for rapid taps', async () => {
    const issue = vi.fn(async () => data()); const publish = vi.fn();
    const c = createVoucherPresentationController({ issue, revoke: vi.fn() }, publish);
    c.open(); c.open(); await tick();
    expect(issue).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenLastCalledWith({ kind: 'ready', data: expect.objectContaining({ token: 'sample' }) });
  });
  it('revokes late tokens without showing them after leaving or backgrounding', async () => {
    let complete!: (value: VoucherPresentation) => void;
    const issue = vi.fn(() => new Promise<VoucherPresentation>((resolve) => { complete = resolve; }));
    const revoke = vi.fn(async () => {}); const views: PresentationView[] = [];
    const c = createVoucherPresentationController({ issue, revoke }, (view) => views.push(view));
    c.open(); await tick(); c.close(); complete(data()); await tick();
    expect(views.some((v) => v.kind === 'ready')).toBe(false);
    expect(revoke).toHaveBeenCalled(); expect(views.at(-1)?.kind).toBe('closed');
  });
  it('does not render an already expired token and supports retry', async () => {
    const issue = vi.fn().mockResolvedValueOnce({ ...data(), expires_at: '2020-01-01T00:00:00Z' }).mockResolvedValueOnce(data());
    const publish = vi.fn(); const c = createVoucherPresentationController({ issue, revoke: vi.fn() }, publish);
    c.open(); await tick(); expect(publish.mock.calls.at(-1)?.[0].kind).toBe('error');
    c.open(); await tick(); expect(publish.mock.calls.at(-1)?.[0].kind).toBe('ready');
  });
});
