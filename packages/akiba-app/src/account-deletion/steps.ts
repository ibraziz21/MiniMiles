/**
 * The account-deletion flow's step machine (AKIBA-MOB-002 §5.2–§5.5).
 *
 * Pure, so the one behaviour that is easy to get wrong and impossible to
 * test on a simulator — where a member lands after each kind of failure —
 * is covered without a device.
 *
 * On the step order: §5.3/§5.4 read as "verify the code, then show a final
 * review", but §7.3's API takes `challengeId`, `otp` and `acknowledgement`
 * in a single call and there is deliberately no standalone verify endpoint.
 * So the code is collected at `verify`, the consequences are re-stated and
 * acknowledged at `confirm`, and both are submitted together. A rejected
 * code therefore surfaces at submit time and sends the member back to
 * `verify` with their context intact, which is exactly what §5.6 requires.
 */
export const DELETION_STEPS = ['review', 'verify', 'confirm', 'receipt'] as const;

export type DeletionStep = (typeof DELETION_STEPS)[number];

/** Steps before the point of no return, where Back/Keep must stay available. */
export function isReversibleStep(step: DeletionStep): boolean {
  return step === 'review' || step === 'verify' || step === 'confirm';
}

export function previousStep(step: DeletionStep): DeletionStep | null {
  switch (step) {
    case 'verify':
      return 'review';
    case 'confirm':
      return 'verify';
    // `review` is the screen's entry point, and `receipt` is terminal —
    // there is no going back from an accepted request.
    default:
      return null;
  }
}
