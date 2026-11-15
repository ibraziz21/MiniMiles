/**
 * The recommendation form's rules, mirroring the web visit card
 * (hub-page app/(protected)/visit/[requestId]/VisitCardFlow.tsx) so a member
 * is asked the same questions in the same order on both. Pure, so every rule
 * is unit-tested without a device.
 */
import type { ContributionAnswers, ContributionItem, ContributionRequest, ContributionTemplate } from '@/contracts/contribution';

export const MAX_ITEMS = 4;
export const MAX_RECOMMENDED_ITEMS = 3;
export const MAX_ITEM_LABEL = 80;
export const MAX_PRIVATE_NOTE = 300;

export type Step = 'recommend' | 'negativeReason' | 'partySize' | 'items' | 'recommendItems' | 'experienceTags' | 'review';

export type Draft = {
  wouldRecommend: boolean | null;
  negativeReasonId: string | null;
  partySize: number | null;
  partySizeIsSixPlus: boolean;
  items: ContributionItem[];
  experienceOptionIds: string[];
  privateNote: string;
};

export function initialDraft(request: ContributionRequest): Draft {
  const saved = request.contribution;
  return {
    wouldRecommend: saved?.wouldRecommend ?? null,
    negativeReasonId: saved?.negativeReasonId ?? null,
    partySize: saved?.partySize ?? null,
    partySizeIsSixPlus: saved?.partySizeIsSixPlus ?? false,
    items: saved?.items ?? [],
    experienceOptionIds: saved?.experienceOptionIds ?? [],
    privateNote: saved?.privateNote ?? '',
  };
}

/** Whether the member can still add or change this visit. */
export function requestIsOpen(request: ContributionRequest, now = Date.now()): boolean {
  if (!['open', 'submitted'].includes(request.state)) return false;
  return Date.parse(request.expiresAt) > now;
}

export function hasExperienceTags(template: ContributionTemplate): boolean {
  return Boolean(template.experience_prompt && template.experience_options.length);
}

/**
 * The steps for the answers so far. "Not this time" goes straight to the
 * private reason and then submits; otherwise who came, what they had, which
 * of those to recommend and what the place is great for, then review.
 */
export function stepSequence(draft: Draft, template: ContributionTemplate): Step[] {
  if (draft.wouldRecommend === false) return ['recommend', 'negativeReason'];
  const steps: Step[] = ['recommend', 'partySize', 'items'];
  if (draft.wouldRecommend === true) {
    if (draft.items.length > 0) steps.push('recommendItems');
    if (hasExperienceTags(template)) steps.push('experienceTags');
  }
  steps.push('review');
  return steps;
}

export function nextStep(current: Step, draft: Draft, template: ContributionTemplate): Step | null {
  const steps = stepSequence(draft, template);
  return steps[steps.indexOf(current) + 1] ?? null;
}

export function previousStep(current: Step, draft: Draft, template: ContributionTemplate): Step | null {
  const steps = stepSequence(draft, template);
  const index = steps.indexOf(current);
  return index > 0 ? steps[index - 1] : null;
}

export function addItem(draft: Draft, label: string, key: string): Draft {
  const rawLabel = label.trim().slice(0, MAX_ITEM_LABEL);
  if (!rawLabel || draft.items.length >= MAX_ITEMS) return draft;
  if (draft.items.some((item) => item.rawLabel.toLowerCase() === rawLabel.toLowerCase())) return draft;
  return { ...draft, items: [...draft.items, { clientItemKey: key, rawLabel, isRecommended: false }] };
}

export function removeItem(draft: Draft, key: string): Draft {
  return { ...draft, items: draft.items.filter((item) => item.clientItemKey !== key) };
}

export function toggleRecommendedItem(draft: Draft, key: string): Draft {
  const target = draft.items.find((item) => item.clientItemKey === key);
  if (!target) return draft;
  const recommended = draft.items.filter((item) => item.isRecommended).length;
  if (!target.isRecommended && recommended >= MAX_RECOMMENDED_ITEMS) return draft;
  return {
    ...draft,
    items: draft.items.map((item) => (item.clientItemKey === key ? { ...item, isRecommended: !item.isRecommended } : item)),
  };
}

export function toggleExperienceOption(draft: Draft, id: string, max: number): Draft {
  if (draft.experienceOptionIds.includes(id)) {
    return { ...draft, experienceOptionIds: draft.experienceOptionIds.filter((existing) => existing !== id) };
  }
  if (draft.experienceOptionIds.length >= max) return draft;
  return { ...draft, experienceOptionIds: [...draft.experienceOptionIds, id] };
}

/**
 * What gets sent. A negative answer sends no items (they would be public
 * picks); the private note is only sent when editing, as on the web, so a
 * first submission can never clear one.
 */
export function buildAnswers(draft: Draft, editing: boolean, idempotencyKey: string): ContributionAnswers {
  return {
    wouldRecommend: draft.wouldRecommend,
    negativeReasonId: draft.wouldRecommend === false ? draft.negativeReasonId : null,
    partySize: draft.partySizeIsSixPlus ? null : draft.partySize,
    partySizeIsSixPlus: draft.partySizeIsSixPlus,
    experienceOptionIds: draft.wouldRecommend === true ? draft.experienceOptionIds : [],
    items:
      draft.wouldRecommend === false
        ? []
        : draft.items.map(({ clientItemKey, rawLabel, isRecommended }) => ({
            clientItemKey,
            rawLabel,
            isRecommended: draft.wouldRecommend === true && isRecommended,
            source: 'customer_input' as const,
          })),
    ...(editing ? { privateNote: draft.privateNote.slice(0, MAX_PRIVATE_NOTE) } : {}),
    idempotencyKey,
  };
}

/** Local id for items and idempotency keys; not security-bearing. */
export function localKey(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
