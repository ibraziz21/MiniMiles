import { useEffect, useRef } from 'react';

/**
 * Tells the screens underneath the recommendation form that a visit was
 * saved, so the store page and Profile → My shares refresh without the
 * member pulling to refresh — and, when they chose "Add photos", open the
 * photo sheet for the visit they just added.
 */
export type ContributionSaved = { requestId: string; merchantSlug: string | null; openPhotos: boolean };

const listeners = new Set<(event: ContributionSaved) => void>();

export function announceContributionSaved(event: ContributionSaved) {
  for (const listener of listeners) listener(event);
}

export function useContributionSaved(handler: (event: ContributionSaved) => void) {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    const listener = (event: ContributionSaved) => latest.current(event);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
}
