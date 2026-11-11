import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadOfferLibrary, saveLikedOffer, removeLikedOffer, rememberServerReminder, forgetServerReminder } from '@/lib/profile-offer-library';
const storage = vi.hoisted(() => ({ getItemAsync: vi.fn(), setItemAsync: vi.fn(), rows: new Map<string, string>() }));
vi.mock('expo-secure-store', () => storage);
const offer = { id: 'offer-1', title: 'Coffee', merchantName: 'Cafe', merchantSlug: 'cafe' };
beforeEach(() => {
  storage.rows.clear(); vi.clearAllMocks();
  storage.getItemAsync.mockImplementation(async key => storage.rows.get(key) ?? null);
  storage.setItemAsync.mockImplementation(async (key, value) => { storage.rows.set(key, value); });
});
describe('profile offer library', () => {
  it('isolates accounts and keeps likes independent from reminders', async () => {
    await saveLikedOffer('member-a', offer);
    await rememberServerReminder('member-a', { ...offer, leadMinutes: 30 });
    await removeLikedOffer('member-a', offer.id);
    expect(await loadOfferLibrary('member-a')).toEqual({ likes: [], reminders: [{ ...offer, leadMinutes: 30 }] });
    expect(await loadOfferLibrary('member-b')).toEqual({ likes: [], reminders: [] });
    await forgetServerReminder('member-a', offer.id);
    expect((await loadOfferLibrary('member-a')).reminders).toEqual([]);
  });
  it('serializes simultaneous mutations without losing a like or reminder', async () => {
    await Promise.all([saveLikedOffer('member-a', offer), rememberServerReminder('member-a', { ...offer, leadMinutes: 60 }), saveLikedOffer('member-a', { ...offer, id: 'offer-2' })]);
    const library = await loadOfferLibrary('member-a');
    expect(library.likes.map(item => item.id)).toEqual(['offer-2', 'offer-1']);
    expect(library.reminders).toHaveLength(1);
  });
  it('surfaces failed reads and writes, and recovers the write queue', async () => {
    storage.getItemAsync.mockRejectedValueOnce(new Error('unavailable'));
    await expect(loadOfferLibrary('member-a')).rejects.toThrow('unavailable');
    storage.setItemAsync.mockRejectedValueOnce(new Error('disk full'));
    await expect(saveLikedOffer('member-a', offer)).rejects.toThrow('disk full');
    await saveLikedOffer('member-a', offer);
    expect((await loadOfferLibrary('member-a')).likes).toEqual([offer]);
  });
  it('does not erase existing data when storage is malformed', async () => {
    storage.getItemAsync.mockResolvedValueOnce('invalid-json');
    await expect(saveLikedOffer('member-a', offer)).rejects.toThrow();
    expect(storage.setItemAsync).not.toHaveBeenCalled();
  });
});
