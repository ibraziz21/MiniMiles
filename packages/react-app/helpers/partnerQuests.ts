// helpers/partnerQuests.ts
export interface ClaimResponse {
  minted?: number;
  txHash?: string;
  queued?: boolean;
  error?: string;
  reason?: string;
}

export async function claimPartnerQuest(
  _userAddress: string, // kept for API compat but address is taken from session server-side
  questId: string
): Promise<ClaimResponse> {
  // Step 1: Get eligibility + attestation token
  const eligRes = await fetch(
    `/api/partner-quests/eligibility?questId=${encodeURIComponent(questId)}`
  );
  const eligData = await eligRes.json();

  if (!eligRes.ok || !eligData.eligible) {
    return {
      error: eligData.message ?? eligData.error ?? eligData.reason ?? "Not eligible",
      reason: eligData.reason ?? eligData.error,
    };
  }

  const { attestationToken } = eligData;

  // Step 2: Submit claim with token
  const claimRes = await fetch("/api/partner-quests/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ questId, attestationToken }),
  });

  const claimData = await claimRes.json();
  if (!claimRes.ok) {
    return {
      ...claimData,
      error: claimData.error ?? "Could not queue this reward",
      reason: claimData.reason,
    };
  }
  return claimData;
}
