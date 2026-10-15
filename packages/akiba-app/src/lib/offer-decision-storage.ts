import * as SecureStore from 'expo-secure-store';

import {
  parseOfferDecisions,
  serializeOfferDecisions,
  type OfferDecisionState,
} from './offer-decisions';

const KEY_PREFIX = 'akiba.offer-decisions.v1';

function keyFor(scope: string): string {
  return `${KEY_PREFIX}.${scope.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

export async function loadOfferDecisionState(scope: string): Promise<OfferDecisionState> {
  try {
    return parseOfferDecisions(await SecureStore.getItemAsync(keyFor(scope)));
  } catch {
    return parseOfferDecisions(null);
  }
}

export async function saveOfferDecisionState(scope: string, state: OfferDecisionState): Promise<void> {
  try {
    await SecureStore.setItemAsync(keyFor(scope), serializeOfferDecisions(state));
  } catch {
    // Swipe choices improve relevance but never block offer discovery.
  }
}
