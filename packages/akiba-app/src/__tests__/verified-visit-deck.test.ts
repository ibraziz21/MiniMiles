import { describe, expect, it } from 'vitest';

import type { VerifiedVisit } from '@/contracts';
import { prioritizeVerifiedVisitsWithPhotos } from '@/lib/verified-visit-deck';

function visit(id: string, photoIds: string[] = []): VerifiedVisit {
  return {
    id,
    favoriteOrder: null,
    experienceLabels: [],
    photos: photoIds.map((photoId) => ({
      id: photoId,
      visitId: id,
      thumbnailUrl: `https://example.com/${photoId}-thumb.webp`,
      displayUrl: `https://example.com/${photoId}.webp`,
      altText: 'Verified visit photo',
      itemLabel: null,
    })),
  };
}

describe('prioritizeVerifiedVisitsWithPhotos', () => {
  it('opens the deck on a photo-backed visit without mixing visit content', () => {
    const visits = [visit('text-only'), visit('photo-one', ['photo-a']), visit('photo-two', ['photo-b'])];

    const result = prioritizeVerifiedVisitsWithPhotos(visits);

    expect(result.map((item) => item.id)).toEqual(['photo-one', 'photo-two', 'text-only']);
    expect(result[0]?.photos[0]?.visitId).toBe('photo-one');
    expect(visits.map((item) => item.id)).toEqual(['text-only', 'photo-one', 'photo-two']);
  });

  it('preserves order when no visits have photos', () => {
    expect(prioritizeVerifiedVisitsWithPhotos([visit('one'), visit('two')]).map((item) => item.id)).toEqual(['one', 'two']);
  });
});
