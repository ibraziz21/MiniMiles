import { describe, expect, it } from 'vitest';

import {
  clearOfferDecisions,
  decidedOfferIds,
  parseOfferDecisions,
  recordOfferDecision,
  removeOfferDecision,
  serializeOfferDecisions,
} from '@/lib/offer-decisions';

describe('offer swipe decisions', () => {
  it('round-trips interested, dismissed, and reminder decisions', () => {
    let state = parseOfferDecisions(null);
    state = recordOfferDecision(state, 'offer-1', 'interested');
    state = recordOfferDecision(state, 'offer-2', 'dismissed');
    state = recordOfferDecision(state, 'offer-3', 'reminder');

    expect(decidedOfferIds(parseOfferDecisions(serializeOfferDecisions(state)))).toEqual(
      new Set(['offer-1', 'offer-2', 'offer-3']),
    );
  });

  it('replaces an existing choice for the same offer', () => {
    let state = recordOfferDecision(parseOfferDecisions(null), 'offer-1', 'dismissed');
    state = recordOfferDecision(state, 'offer-1', 'interested');

    expect(state.entries).toEqual([['offer-1', 'i']]);
  });

  it('supports undo and review-again clearing', () => {
    let state = parseOfferDecisions('{"version":1,"entries":[["offer-1","i"],["offer-2","d"],["old","r"]]}');
    state = removeOfferDecision(state, 'offer-2');
    state = clearOfferDecisions(state, ['offer-1']);

    expect(state.entries).toEqual([['old', 'r']]);
  });

  it('fails closed on malformed persisted data', () => {
    expect(parseOfferDecisions('not-json').entries).toEqual([]);
    expect(parseOfferDecisions('{"version":2,"entries":[]}').entries).toEqual([]);
  });

  it('keeps storage bounded', () => {
    let state = parseOfferDecisions(null);
    for (let index = 0; index < 60; index += 1) {
      state = recordOfferDecision(state, `offer-${index}`, 'dismissed');
    }

    expect(state.entries).toHaveLength(40);
    expect(state.entries[0][0]).toBe('offer-20');
  });
});
