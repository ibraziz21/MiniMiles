import type { VoucherPresentation } from '@/contracts/owned-vouchers';
export type PresentationView = { kind: 'closed' } | { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; data: VoucherPresentation };
export function createVoucherPresentationController(api: { issue: () => Promise<VoucherPresentation>; revoke: () => Promise<void> }, publish: (view: PresentationView) => void) {
  let generation = 0;
  let active = false;
  let queue: Promise<void> = Promise.resolve();
  let issuing = false;
  function open() {
    if (issuing) return;
    active = true;
    const version = ++generation;
    issuing = true;
    publish({ kind: 'loading' });
    queue = queue.catch(() => undefined).then(async () => {
      try {
        const data = await api.issue();
        if (!active || version !== generation) { await api.revoke(); return; }
        if (Date.parse(data.expires_at) <= Date.now()) throw new Error('QR expired. Please try again.');
        publish({ kind: 'ready', data });
      } catch (error) {
        if (active && version === generation) publish({ kind: 'error', message: error instanceof Error ? error.message : 'Unable to show QR' });
      } finally { issuing = false; }
    });
  }
  function close() {
    const wasActive = active;
    active = false;
    generation++;
    publish({ kind: 'closed' });
    if (wasActive) queue = queue.catch(() => undefined).then(async () => { await api.revoke(); }).catch(() => undefined);
  }
  return { open, close };
}
