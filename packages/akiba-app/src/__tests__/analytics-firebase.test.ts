import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const firebase = vi.hoisted(() => ({ event: vi.fn(), screen: vi.fn() }));
vi.mock('@/analytics/firebase', async (importActual) => ({
  ...(await importActual<typeof import('@/analytics/firebase')>()),
  sendFirebaseEvent: firebase.event,
  sendFirebaseScreenView: firebase.screen,
}));

const { firebaseName, toFirebaseParams } = await import('@/analytics/firebase');
const { track, trackScreen } = await import('@/analytics/track');

beforeEach(() => {
  firebase.event.mockReset();
  firebase.screen.mockReset();
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Firebase limits', () => {
  it('makes names Firebase accepts, and refuses reserved or unusable ones', () => {
    expect(firebaseName('onboarding_completed')).toBe('onboarding_completed');
    expect(firebaseName('push-permission.granted')).toBe('push_permission_granted');
    expect(firebaseName('a'.repeat(50))).toHaveLength(40);
    expect(firebaseName('1st_event')).toBeNull();
    expect(firebaseName('firebase_campaign')).toBeNull();
    expect(firebaseName('ga_session')).toBeNull();
  });

  it('converts values to types Firebase takes', () => {
    expect(
      toFirebaseParams({
        welcomeVoucher: true,
        step: 'pass',
        attempts: 2,
        nothing: null,
        missing: undefined,
        broken: Number.NaN,
        long: 'x'.repeat(150),
      }),
    ).toEqual({ welcomeVoucher: 'true', step: 'pass', attempts: 2, long: 'x'.repeat(100) });
  });

  it('sends at most 25 parameters', () => {
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`p${i}`, i]));
    expect(Object.keys(toFirebaseParams(many))).toHaveLength(25);
  });
});

describe('track', () => {
  it('logs in development and sends nothing', () => {
    track('onboarding_completed', { welcomeVoucher: true });
    expect(firebase.event).not.toHaveBeenCalled();
  });

  it('sends release-build events to Firebase, after removing personal data', () => {
    vi.stubEnv('NODE_ENV', 'production');
    track('otp_sent', { email: 'a@b.co', user_id: 'u1', step: 'verify', note: 'someone@example.com' });
    expect(firebase.event).toHaveBeenCalledWith('otp_sent', { step: 'verify', note: '[redacted]' });
  });

  it('names screens by shape, never by the id in the path', () => {
    vi.stubEnv('NODE_ENV', 'production');
    trackScreen('/merchants/kahawa-corner');
    trackScreen('/vouchers/0b6a1c2e-5f3d-4c1a-9e8b-7d6c5b4a3f21');
    trackScreen('');
    expect(firebase.screen.mock.calls.map((call) => call[0])).toEqual(['/merchants/:id', '/vouchers/:id', '/']);
  });
});
