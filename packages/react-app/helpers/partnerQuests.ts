// lib/partner-quests.ts
export interface ClaimResponse {
  minted?: number;
  txHash?: string;
  error?: string;
}

export async function claimPartnerQuest(
  userAddress: string,
  questId: string
): Promise<ClaimResponse> {
  const res = await fetch("/api/partner-quests/claim", {   // ← dash not underscore
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" }, // ← charset needed in MiniPay
    body: JSON.stringify({ userAddress, questId }),
  });

  return res.json();
}
