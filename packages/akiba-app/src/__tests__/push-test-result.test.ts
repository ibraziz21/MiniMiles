import { describe, expect, it, vi } from 'vitest';

vi.mock('@/api', () => ({ createApiClient: vi.fn() }));
vi.mock('@/push/register', () => ({ registerForPushNotifications: vi.fn() }));

const { describeTestPush, registrationProblem } = await import('@/push/test-push');

describe('Settings test notification messages', () => {
  it('tells the member a sent test should arrive', () => {
    expect(describeTestPush({ status: 'sent', devices: 1, accepted: 1, errors: [] }).title).toBe('Test sent');
  });

  it('separates a server-side pause from a phone problem', () => {
    expect(describeTestPush({ status: 'push_disabled' }).title).toBe('Notifications are paused');
    expect(describeTestPush({ status: 'no_devices' }).title).toBe('This phone isn’t registered');
  });

  it('points an expired phone address back at reopening the app', () => {
    const result = describeTestPush({ status: 'failed', devices: 1, errors: ['DeviceNotRegistered: gone'] });
    expect(result.message).toContain('Close and reopen Akiba');
  });

  it('sends the member to their phone settings when permission is off', () => {
    expect(registrationProblem({ status: 'denied' })?.title).toBe('Notifications are off');
    expect(registrationProblem({ status: 'registered' })).toBeNull();
  });
});
