import type { VerifiedVisit } from '@/contracts';

/**
 * Lead the community deck with visits that can deliver the visual preview
 * promised by the entry card, while preserving recency within each group.
 * A photo always stays attached to its own anonymous visit.
 */
export function prioritizeVerifiedVisitsWithPhotos(visits: readonly VerifiedVisit[]): VerifiedVisit[] {
  const withPhotos: VerifiedVisit[] = [];
  const withoutPhotos: VerifiedVisit[] = [];

  for (const visit of visits) {
    if (visit.photos.length > 0) withPhotos.push(visit);
    else withoutPhotos.push(visit);
  }

  return [...withPhotos, ...withoutPhotos];
}
