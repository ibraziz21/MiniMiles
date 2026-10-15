export type OfferDecision = 'interested' | 'dismissed' | 'reminder';

type StoredDecision = [offerId: string, kind: 'i' | 'd' | 'r'];

export type OfferDecisionState = {
  version: 1;
  entries: StoredDecision[];
};

const EMPTY_STATE: OfferDecisionState = { version: 1, entries: [] };
const MAX_DECISIONS = 40;

const encodeKind: Record<OfferDecision, StoredDecision[1]> = {
  interested: 'i',
  dismissed: 'd',
  reminder: 'r',
};

function isStoredDecision(value: unknown): value is StoredDecision {
  return Array.isArray(value)
    && value.length === 2
    && typeof value[0] === 'string'
    && value[0].length > 0
    && (value[1] === 'i' || value[1] === 'd' || value[1] === 'r');
}

export function parseOfferDecisions(raw: string | null): OfferDecisionState {
  if (!raw) return EMPTY_STATE;
  try {
    const value = JSON.parse(raw) as { version?: unknown; entries?: unknown };
    if (value.version !== 1 || !Array.isArray(value.entries)) return EMPTY_STATE;
    return { version: 1, entries: value.entries.filter(isStoredDecision).slice(-MAX_DECISIONS) };
  } catch {
    return EMPTY_STATE;
  }
}

export function serializeOfferDecisions(state: OfferDecisionState): string {
  return JSON.stringify({ version: 1, entries: state.entries.slice(-MAX_DECISIONS) });
}

export function decidedOfferIds(state: OfferDecisionState): Set<string> {
  return new Set(state.entries.map(([offerId]) => offerId));
}

export function recordOfferDecision(
  state: OfferDecisionState,
  offerId: string,
  decision: OfferDecision,
): OfferDecisionState {
  const entries = state.entries.filter(([existingId]) => existingId !== offerId);
  entries.push([offerId, encodeKind[decision]]);
  return { version: 1, entries: entries.slice(-MAX_DECISIONS) };
}

export function removeOfferDecision(state: OfferDecisionState, offerId: string): OfferDecisionState {
  return { version: 1, entries: state.entries.filter(([existingId]) => existingId !== offerId) };
}

export function clearOfferDecisions(state: OfferDecisionState, offerIds: Iterable<string>): OfferDecisionState {
  const cleared = new Set(offerIds);
  return { version: 1, entries: state.entries.filter(([offerId]) => !cleared.has(offerId)) };
}
