import {
  MERCHANT_DISCOVERY_QUEST_IDS,
  type MerchantDiscoveryQuestId,
} from "@/lib/merchantDiscoveryQuests";

type JobRow = {
  status: string;
  payload?: { questId?: string } | null;
  updated_at?: string | null;
};

type ProofRow = {
  partner_quest_id: string;
};

type EventRow = {
  event_type: string;
  partner_quest_id: string;
};

function emptyStatusCounts() {
  return { pending: 0, processing: 0, completed: 0, failed: 0 };
}

export function summarizeMerchantQuestHealth(input: {
  jobs: JobRow[];
  proofs: ProofRow[];
  events: EventRow[];
  activeCampaignGameTypes: string[] | null;
  rollout?: {
    enabled: boolean;
    percentage: number;
    allowlistCount: number;
  };
  now?: Date;
}) {
  const nowMs = (input.now ?? new Date()).getTime();
  const questIds = new Set<string>(MERCHANT_DISCOVERY_QUEST_IDS);
  const merchantJobs = input.jobs.filter((job) =>
    job.payload?.questId ? questIds.has(job.payload.questId) : false,
  );
  const byStatus = emptyStatusCounts();
  const byQuest = Object.fromEntries(
    MERCHANT_DISCOVERY_QUEST_IDS.map((questId) => [
      questId,
      emptyStatusCounts(),
    ]),
  ) as Record<MerchantDiscoveryQuestId, ReturnType<typeof emptyStatusCounts>>;

  let stuckProcessing = 0;
  for (const job of merchantJobs) {
    if (job.status in byStatus) {
      byStatus[job.status as keyof typeof byStatus] += 1;
      const questId = job.payload?.questId as MerchantDiscoveryQuestId;
      byQuest[questId][job.status as keyof typeof byStatus] += 1;
    }
    if (
      job.status === "processing" &&
      job.updated_at &&
      nowMs - new Date(job.updated_at).getTime() > 10 * 60_000
    ) {
      stuckProcessing += 1;
    }
  }

  const proofsByQuest: Record<string, number> = {};
  for (const proof of input.proofs) {
    if (!questIds.has(proof.partner_quest_id)) continue;
    proofsByQuest[proof.partner_quest_id] =
      (proofsByQuest[proof.partner_quest_id] ?? 0) + 1;
  }

  const eventsByType: Record<string, number> = {};
  for (const event of input.events) {
    if (!questIds.has(event.partner_quest_id)) continue;
    eventsByType[event.event_type] =
      (eventsByType[event.event_type] ?? 0) + 1;
  }

  const warnings: string[] = [];
  if (input.rollout && !input.rollout.enabled) {
    warnings.push("Merchant quest rollout master switch is disabled.");
  } else if (
    input.rollout &&
    input.rollout.percentage === 0 &&
    input.rollout.allowlistCount === 0
  ) {
    warnings.push("No wallets are included in the merchant quest rollout.");
  }
  if (!input.activeCampaignGameTypes?.length) {
    warnings.push("No active sponsored-game campaign is configured.");
  }
  if (byStatus.failed > 0) {
    warnings.push(`${byStatus.failed} merchant quest reward job(s) failed.`);
  }
  if (stuckProcessing > 0) {
    warnings.push(
      `${stuckProcessing} merchant quest reward job(s) have been processing for over 10 minutes.`,
    );
  }

  return {
    healthy: warnings.length === 0,
    queue: {
      total: merchantJobs.length,
      byStatus,
      byQuest,
      stuckProcessing,
    },
    proofs: {
      total: Object.values(proofsByQuest).reduce(
        (sum, value) => sum + value,
        0,
      ),
      byQuest: proofsByQuest,
    },
    events: {
      total: Object.values(eventsByType).reduce(
        (sum, value) => sum + value,
        0,
      ),
      byType: eventsByType,
    },
    sponsoredCampaign: {
      configured: !!input.activeCampaignGameTypes?.length,
      gameTypes: input.activeCampaignGameTypes ?? [],
    },
    ...(input.rollout ? { rollout: input.rollout } : {}),
    warnings,
  };
}
