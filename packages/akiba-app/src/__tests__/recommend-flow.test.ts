import { describe, expect, it } from 'vitest';

import type { ContributionRequest, ContributionTemplate } from '@/contracts/contribution';
import {
  MAX_ITEMS,
  addItem,
  buildAnswers,
  initialDraft,
  nextStep,
  previousStep,
  removeItem,
  requestIsOpen,
  stepSequence,
  toggleExperienceOption,
  toggleRecommendedItem,
  type Draft,
} from '@/features/recommend/flow';

const TEMPLATE: ContributionTemplate = {
  recommendation_prompt: 'Would you recommend {{merchantName}}?',
  negative_reason_options: [{ id: 'slow', label: 'Service was slow' }],
  party_size_prompt: 'Who was on the bill?',
  item_prompt: 'What did you have?',
  recommendation_item_prompt: 'What would you recommend?',
  experience_prompt: 'What is it great for?',
  experience_options: [
    { id: 'family', inputLabel: 'Families', publicLabel: 'Good for families' },
    { id: 'work', inputLabel: 'Working', publicLabel: 'Good for working' },
    { id: 'date', inputLabel: 'Dates', publicLabel: 'Good for dates' },
  ],
  max_experience_options: 2,
  photo_prompt: 'Add photos',
  photo_safety_guidance: 'No faces',
};

function request(overrides: Partial<ContributionRequest> = {}): ContributionRequest {
  return {
    id: 'req-1',
    state: 'open',
    expiresAt: '2099-01-01T00:00:00Z',
    merchant: { name: 'Kahawa Corner', slug: 'kahawa-corner' },
    template: TEMPLATE,
    contribution: null,
    ...overrides,
  };
}

const blank: Draft = initialDraft(request());
const yes: Draft = { ...blank, wouldRecommend: true };

describe('recommendation steps', () => {
  it('asks the full set after "Yes", and only the private reason after "Not this time"', () => {
    expect(stepSequence(yes, TEMPLATE)).toEqual(['recommend', 'partySize', 'items', 'experienceTags', 'review']);
    const withItem = addItem(yes, 'Biryani', 'k1');
    expect(stepSequence(withItem, TEMPLATE)).toEqual([
      'recommend', 'partySize', 'items', 'recommendItems', 'experienceTags', 'review',
    ]);
    expect(stepSequence({ ...blank, wouldRecommend: false }, TEMPLATE)).toEqual(['recommend', 'negativeReason']);
  });

  it('skips the "great for" step when the template has none', () => {
    const template = { ...TEMPLATE, experience_prompt: null };
    expect(stepSequence(yes, template)).not.toContain('experienceTags');
  });

  it('moves forward and back along the sequence', () => {
    expect(nextStep('partySize', yes, TEMPLATE)).toBe('items');
    expect(previousStep('items', yes, TEMPLATE)).toBe('partySize');
    expect(previousStep('recommend', yes, TEMPLATE)).toBeNull();
    expect(nextStep('review', yes, TEMPLATE)).toBeNull();
  });
});

describe('recommendation answers', () => {
  it('caps items, trims labels and ignores duplicates', () => {
    let draft = yes;
    for (const [index, label] of ['  Chai ', 'chai', 'Mandazi', 'Samosa', 'Pilau', 'Extra'].entries()) {
      draft = addItem(draft, label, `k${index}`);
    }
    expect(draft.items.map((item) => item.rawLabel)).toEqual(['Chai', 'Mandazi', 'Samosa', 'Pilau']);
    expect(draft.items).toHaveLength(MAX_ITEMS);
    expect(removeItem(draft, 'k0').items.map((item) => item.rawLabel)).toEqual(['Mandazi', 'Samosa', 'Pilau']);
  });

  it('recommends at most three items', () => {
    let draft = yes;
    for (const key of ['a', 'b', 'c', 'd']) draft = addItem(draft, key.toUpperCase(), key);
    for (const key of ['a', 'b', 'c', 'd']) draft = toggleRecommendedItem(draft, key);
    expect(draft.items.filter((item) => item.isRecommended).map((item) => item.clientItemKey)).toEqual(['a', 'b', 'c']);
    expect(toggleRecommendedItem(draft, 'a').items.find((item) => item.clientItemKey === 'a')?.isRecommended).toBe(false);
  });

  it('respects the template\'s "great for" limit', () => {
    let draft = yes;
    for (const id of ['family', 'work', 'date']) draft = toggleExperienceOption(draft, id, 2);
    expect(draft.experienceOptionIds).toEqual(['family', 'work']);
  });

  it('never sends picks or tags with a negative answer, and keeps the reason private-only', () => {
    let draft: Draft = addItem({ ...blank, wouldRecommend: false, negativeReasonId: 'slow' }, 'Chai', 'k');
    draft = { ...draft, experienceOptionIds: ['family'] };
    expect(buildAnswers(draft, false, 'key')).toEqual({
      wouldRecommend: false,
      negativeReasonId: 'slow',
      partySize: null,
      partySizeIsSixPlus: false,
      experienceOptionIds: [],
      items: [],
      idempotencyKey: 'key',
    });
  });

  it('drops a stale reason after switching to "Yes", and sends "6+" as a flag', () => {
    const draft: Draft = { ...yes, negativeReasonId: 'slow', partySize: 3, partySizeIsSixPlus: true };
    const answers = buildAnswers(addItem(draft, 'Chai', 'k'), false, 'key');
    expect(answers).toMatchObject({ negativeReasonId: null, partySize: null, partySizeIsSixPlus: true });
    expect(answers.items).toEqual([{ clientItemKey: 'k', rawLabel: 'Chai', isRecommended: false, source: 'customer_input' }]);
  });

  it('sends the private note only when editing', () => {
    const draft = { ...yes, privateNote: 'Ask for the window seat' };
    expect(buildAnswers(draft, false, 'k')).not.toHaveProperty('privateNote');
    expect(buildAnswers(draft, true, 'k').privateNote).toBe('Ask for the window seat');
  });

  it('starts an edit from the saved answers', () => {
    const saved = {
      id: 'c1',
      wouldRecommend: true,
      negativeReasonId: null,
      partySize: 2,
      partySizeIsSixPlus: false,
      experienceOptionIds: ['work'],
      privateNote: 'note',
      items: [{ clientItemKey: 'k', rawLabel: 'Chai', isRecommended: true }],
    };
    expect(initialDraft(request({ state: 'submitted', contribution: saved }))).toEqual({
      wouldRecommend: true,
      negativeReasonId: null,
      partySize: 2,
      partySizeIsSixPlus: false,
      items: saved.items,
      experienceOptionIds: ['work'],
      privateNote: 'note',
    });
  });
});

describe('requestIsOpen', () => {
  it('allows open and submitted visits until they expire', () => {
    const now = Date.parse('2026-11-11T12:00:00Z');
    expect(requestIsOpen(request({ expiresAt: '2026-11-12T00:00:00Z' }), now)).toBe(true);
    expect(requestIsOpen(request({ state: 'submitted', expiresAt: '2026-11-12T00:00:00Z' }), now)).toBe(true);
    expect(requestIsOpen(request({ expiresAt: '2026-11-11T11:59:00Z' }), now)).toBe(false);
    expect(requestIsOpen(request({ state: 'dismissed' }), now)).toBe(false);
  });
});
