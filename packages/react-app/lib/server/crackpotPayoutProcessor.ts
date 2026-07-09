import {
  leaseNextPayoutJob,
  processPayoutJob,
} from "@/lib/server/crackpotPayoutWorker";
import { rotateActiveCycle } from "@/lib/server/crackpotCycleSync";

type PlayVersion = "miles" | "usdt";

type DrainOptions = {
  limit?: number;
  leaseOwner?: string;
};

export type CrackPotPayoutDrainResult = {
  processed: Array<{ id: string; status: "succeeded" | "failed" | "manual_review" }>;
  processedCount: number;
  rotations: Array<{
    version: PlayVersion;
    ok: boolean;
    cycleId?: string;
    contractCycleId?: number | null;
    status?: string;
    error?: string;
  }>;
};

function jobVersion(job: { contract_version: number }): PlayVersion {
  return job.contract_version === 1 ? "usdt" : "miles";
}

export async function drainCrackPotPayoutQueue(
  options: DrainOptions = {},
): Promise<CrackPotPayoutDrainResult> {
  const limit = Math.max(1, Math.min(5, Number.isFinite(options.limit) ? options.limit! : 1));
  const leaseOwner = options.leaseOwner ?? "crackpot-payout-worker";

  const processed: CrackPotPayoutDrainResult["processed"] = [];
  const rotations: CrackPotPayoutDrainResult["rotations"] = [];

  for (let i = 0; i < limit; i++) {
    const job = await leaseNextPayoutJob(leaseOwner);
    if (!job) break;

    const result = await processPayoutJob(job);
    processed.push({ id: job.id, status: result.status });

    if (result.status !== "succeeded") continue;

    const version = jobVersion(job);
    try {
      const cycle = await rotateActiveCycle(version, job.chain_id);
      rotations.push({
        version,
        ok: true,
        cycleId: cycle.id,
        contractCycleId: cycle.contract_cycle_id,
        status: cycle.status,
      });
    } catch (err: any) {
      console.error(`[crackpotPayoutProcessor] ${version} rotation after payout failed`, err);
      rotations.push({
        version,
        ok: false,
        error: err?.message ?? "cycle_rotation_failed",
      });
    }
  }

  return {
    processed,
    processedCount: processed.length,
    rotations,
  };
}
