import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiTimeoutError } from '@/api/errors';
import { REQUEST_TIMEOUT_MS, fetchWithTimeout } from '@/api/timeout';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A fetch that never settles — the stalled-connection case. */
function hangingFetch() {
  return vi.fn(
    (_input: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
      }),
  );
}

describe('fetchWithTimeout', () => {
  it('returns the response untouched when the request completes in time', async () => {
    const response = { ok: true, status: 200 } as Response;
    vi.stubGlobal('fetch', vi.fn(async () => response));

    await expect(fetchWithTimeout('https://example.test/x')).resolves.toBe(response);
  });

  it('forwards method, headers and body to fetch', async () => {
    // Params declared so the assertions below can read the init off
    // `mock.calls` with a type rather than a cast.
    const fetchMock = vi.fn(async (_input: string, _init: RequestInit) => ({ ok: true } as Response));
    vi.stubGlobal('fetch', fetchMock);

    await fetchWithTimeout('https://example.test/x', {
      method: 'POST',
      headers: { 'X-Akiba-Platform': 'android' },
      body: '{"a":1}',
    });

    const init = fetchMock.mock.calls[0][1];
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-Akiba-Platform']).toBe('android');
    expect(init.body).toBe('{"a":1}');
    // The caller never passes a signal; the helper always supplies its own.
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('raises ApiTimeoutError when the request outlives its budget', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', hangingFetch());

    const pending = fetchWithTimeout('https://example.test/x', {}, 5_000);
    const assertion = expect(pending).rejects.toBeInstanceOf(ApiTimeoutError);
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
  });

  it('carries a member-readable message, since screens render it directly', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', hangingFetch());

    const pending = fetchWithTimeout('https://example.test/x', {}, 1_000).catch((error) => error);
    await vi.advanceTimersByTimeAsync(1_000);
    const error = await pending;

    expect(error.message).toBe('The request took too long. Check your connection and try again.');
    expect(error.message).not.toMatch(/abort/i);
    expect(error.timeoutMs).toBe(1_000);
  });

  it('does not fire after the request has already settled', async () => {
    // A timer left running would abort a settled request and, with a reused
    // controller, could surface as a spurious failure later.
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true } as Response)));

    await fetchWithTimeout('https://example.test/x', {}, 5_000);

    expect(vi.getTimerCount()).toBe(0);
  });

  it('passes a genuine network failure through rather than calling it a timeout', async () => {
    // Airplane mode, DNS failure and TLS errors each deserve their own
    // diagnosis; relabelling them as timeouts would hide the real cause.
    const failure = new TypeError('Network request failed');
    vi.stubGlobal('fetch', vi.fn(async () => { throw failure; }));

    await expect(fetchWithTimeout('https://example.test/x')).rejects.toBe(failure);
  });

  it('budgets long enough for a cold start on a slow network', () => {
    // Guards against someone "tightening" this into false failures: the
    // budget exists to catch a stuck request, not a merely slow one.
    expect(REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000);
  });
});
