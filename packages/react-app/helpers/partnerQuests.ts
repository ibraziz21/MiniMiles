// helpers/partnerQuests.ts
export interface ClaimResponse {
  minted?: number;
  txHash?: string;
  error?: string;
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
    return { error: eligData.message ?? eligData.error ?? eligData.reason ?? "Not eligible" };
  }

  const { attestationToken } = eligData;

  // Step 2: Submit claim with token
  const claimRes = await fetch("/api/partner-quests/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ questId, attestationToken }),
  });

  return claimRes.json();
}
