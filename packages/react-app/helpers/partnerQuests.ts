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
    const res = await fetch('/api/partner_quests/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userAddress, questId }),
    });
  
    return res.json();
  }
  