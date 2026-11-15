import { scheduleOfferReminder, scheduleFundedOfferReminder, cancelMemberOfferReminders } from '@/push/funded-offer-reminder';
import type { FundedOffer } from '@/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const notifications = vi.hoisted(() => ({
  setNotificationChannelAsync: vi.fn(),
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  scheduleNotificationAsync: vi.fn(),
  getAllScheduledNotificationsAsync: vi.fn(),
  cancelScheduledNotificationAsync: vi.fn(),
  AndroidImportance: { DEFAULT: 3 },
  IosAuthorizationStatus: { PROVISIONAL: 3 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));
vi.mock('expo-notifications', () => notifications);
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));

beforeEach(() => {
  vi.clearAllMocks();
  notifications.getPermissionsAsync.mockResolvedValue({ granted: true });
});

describe('offer reminders without an opening schedule', () => {
  it('schedules a reminder with a stable id, Android channel and merchant link', async () => {
    const date = new Date(Date.now() + 60_000);
    await scheduleOfferReminder({ id: 'offer-1', title: 'Lunch deal', merchantSlug: 'cafe', date });
    expect(notifications.scheduleNotificationAsync).toHaveBeenCalledWith({
      identifier: 'offer-1',
      content: {
        title: 'Offer reminder', body: 'Check the latest availability for Lunch deal.',
        data: { url: '/merchants/cafe' },
      },
      trigger: { type: 'date', date, channelId: 'offer-reminders' },
    });
  });

  it('keeps owner, reminder time and opening metadata for profile management', async () => {
    const openingAt = new Date(Date.now() + 3_600_000).toISOString();
    await scheduleFundedOfferReminder({ allocationId: 'allocation', title: 'Coffee', nextOpeningAt: openingAt, merchant: { slug: 'cafe' } } as FundedOffer, 30, 'member-a');
    expect(notifications.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({
      identifier: 'funded-offer-allocation',
      content: expect.objectContaining({ data: { ownerId: 'member-a', offerTitle: 'Coffee', remindAt: new Date(Date.parse(openingAt) - 30 * 60_000).toISOString(), openingAt, url: '/merchants/cafe' } }),
    }));
  });

  it('does not claim success when notifications are denied', async () => {
    notifications.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
    await expect(scheduleOfferReminder({
      id: 'offer-1', title: 'Lunch deal', merchantSlug: 'cafe', date: new Date(Date.now() + 60_000),
    })).rejects.toThrow('Allow Akiba notifications');
    expect(notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('cancels only the departing member’s notifications', async () => {
    notifications.getAllScheduledNotificationsAsync.mockResolvedValue([
      { identifier: 'mine', content: { data: { ownerId: 'member-a' } } },
      { identifier: 'other', content: { data: { ownerId: 'member-b' } } },
    ]);
    await cancelMemberOfferReminders('member-a');
    expect(notifications.cancelScheduledNotificationAsync).toHaveBeenCalledExactlyOnceWith('mine');
  });

  it('rejects a reminder time that has already passed', async () => {
    await expect(scheduleOfferReminder({
      id: 'offer-1', title: 'Lunch deal', merchantSlug: 'cafe', date: new Date(0),
    })).rejects.toThrow('reminder time has passed');
    expect(notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});
