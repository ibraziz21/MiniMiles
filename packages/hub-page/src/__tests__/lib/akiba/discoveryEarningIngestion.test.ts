import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const queueContributionRequestNotification = vi.fn();

// Every query in recordVerifiedEarningForDiscovery ends in maybeSingle() or
// an awaited update chain; one chainable stub covers both.
function chain(result: unknown) {
  const node: Record<string, unknown> = {};
  for (const method of ["upsert", "select", "update", "eq"]) node[method] = vi.fn(() => node);
  node.maybeSingle = vi.fn(async () => result);
  node.then = (resolve: (value: unknown) => void) => resolve({ error: null });
  return node;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => chain({ data: { id: "earning-event-1" }, error: null }),
    rpc,
  }),
}));
vi.mock("@/lib/akiba/discoveryContributionsRollout", () => ({
  isDiscoveryContributionsEnabledFor: () => true,
}));
vi.mock("@/lib/akiba/contributionRequestNotification", () => ({
  queueContributionRequestNotification,
}));

const { recordVerifiedEarningForDiscovery } = await import("@/lib/akiba/discoveryEarningIngestion");

const EVENT = {
  eventId: "purchase:abc",
  hubUserId: "8b0f6c1e-0000-4000-8000-000000000001",
  merchantId: "8b0f6c1e-0000-4000-8000-000000000002",
  merchantName: "Kahawa Corner",
  milesAwarded: 25,
  source: "merchant_purchase" as const,
  occurredAt: "2026-11-10T09:00:00.000Z",
};

describe("recordVerifiedEarningForDiscovery — recommendation push", () => {
  beforeEach(() => vi.clearAllMocks());

  it("queues a push when the visit opens a new request", async () => {
    rpc.mockResolvedValue({ data: [{ ok: true, request_id: "request-1", reason: "created" }], error: null });

    await recordVerifiedEarningForDiscovery(EVENT, "in_store");

    expect(queueContributionRequestNotification).toHaveBeenCalledWith({
      requestId: "request-1",
      hubUserId: EVENT.hubUserId,
      merchantId: EVENT.merchantId,
      merchantName: "Kahawa Corner",
    });
  });

  it("does not ask again for a retried visit", async () => {
    rpc.mockResolvedValue({ data: [{ ok: true, request_id: "request-1", reason: "already_exists" }], error: null });

    await recordVerifiedEarningForDiscovery(EVENT, "in_store");

    expect(queueContributionRequestNotification).not.toHaveBeenCalled();
  });

  it("does not ask when the request is refused", async () => {
    rpc.mockResolvedValue({ data: [{ ok: false, request_id: null, reason: "cooldown_active" }], error: null });

    await recordVerifiedEarningForDiscovery(EVENT, "in_store");

    expect(queueContributionRequestNotification).not.toHaveBeenCalled();
  });

  it("never opens a request for an earning that is not in store", async () => {
    await recordVerifiedEarningForDiscovery(EVENT, "unknown");

    expect(rpc).not.toHaveBeenCalled();
    expect(queueContributionRequestNotification).not.toHaveBeenCalled();
  });
});
