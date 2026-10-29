export class FundedDiscoveryUnavailable extends Error {
  constructor(public readonly stage: string, public readonly allocationIds: string[] = []) {
    super("Free offers are temporarily unavailable");
    this.name = "FundedDiscoveryUnavailable";
    console.error(JSON.stringify({ event: "funded_discovery_unavailable", stage, allocationIds }));
  }
}
export async function fundedDiscoveryResult<T>(load: () => Promise<T[]>): Promise<{ offers: T[]; unavailable: boolean }> {
  try { return { offers: await load(), unavailable: false }; }
  catch (error) {
    if (!(error instanceof FundedDiscoveryUnavailable)) throw error;
    return { offers: [], unavailable: true };
  }
}
