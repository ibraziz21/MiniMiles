export const PUSH_CAMPAIGN_TYPES = ["feature", "merchant", "general"] as const;
export type PushCampaignType = (typeof PUSH_CAMPAIGN_TYPES)[number];

export type ValidPushCampaignInput = {
  campaignType: PushCampaignType;
  title: string;
  body: string;
  deepLink: string;
  idempotencyKey: string;
};

export function validatePushCampaignInput(
  input: unknown,
): { ok: true; value: ValidPushCampaignInput } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "Invalid request body" };
  const value = input as Record<string, unknown>;

  if (!PUSH_CAMPAIGN_TYPES.includes(value.campaignType as PushCampaignType)) {
    return { ok: false, error: "Choose a valid campaign type" };
  }

  const title = typeof value.title === "string" ? value.title.trim() : "";
  if (!title || title.length > 60) {
    return { ok: false, error: "Title must be between 1 and 60 characters" };
  }

  const body = typeof value.body === "string" ? value.body.trim() : "";
  if (!body || body.length > 160) {
    return { ok: false, error: "Message must be between 1 and 160 characters" };
  }

  const deepLink = typeof value.deepLink === "string" ? value.deepLink.trim() : "";
  if (!deepLink.startsWith("/") || deepLink.startsWith("//") || deepLink.length > 500) {
    return { ok: false, error: "Destination must be a relative Akiba path such as /merchants" };
  }

  const idempotencyKey = typeof value.idempotencyKey === "string" ? value.idempotencyKey.trim() : "";
  if (!idempotencyKey || idempotencyKey.length > 128) {
    return { ok: false, error: "Invalid idempotency key" };
  }

  return {
    ok: true,
    value: {
      campaignType: value.campaignType as PushCampaignType,
      title,
      body,
      deepLink,
      idempotencyKey,
    },
  };
}
