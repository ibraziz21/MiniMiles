// lib/server/legacySelfClaimGate.ts
//
// Shared 409 response every legacy sponsored-quest route returns once its
// family is in self-claim mode for the calling wallet
// (docs/all-quests-self-claim-spec.md §5.4, §10). Closes the sponsored path
// for cached/old frontend bundles that never learned about the voucher
// route — it is not enough to change only the current client.

import { NextResponse } from "next/server";

export function selfClaimRequiredResponse() {
  return NextResponse.json(
    {
      success: false,
      code: "self-claim-required",
      message: "Update the app to claim this reward from your wallet.",
    },
    { status: 409 },
  );
}
