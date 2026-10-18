import { beforeEach, describe, expect, it, vi } from "vitest";

const reconcileRecentVerifiedEarnings = vi.fn();
vi.mock("@/lib/akiba/verifiedEarningReconciliation", () => ({ reconcileRecentVerifiedEarnings }));

const { GET, POST } = await import("@/app/api/internal/reconcile-verified-earnings/route");

beforeEach(() => {
  vi.clearAllMocks();
  process.env.INTERNAL_WEBHOOK_SECRET = "worker-secret";
  process.env.CRON_SECRET = "cron-secret";
  reconcileRecentVerifiedEarnings.mockResolvedValue({
    scanned: 21,
    eligible: 21,
    reconciled: 16,
    missingHubIdentity: 5,
    missingMerchant: 0,
  });
});

describe("/api/internal/reconcile-verified-earnings", () => {
  it("rejects an unauthenticated manual request", async () => {
    const response = await POST(new Request("https://pass.test/api/internal/reconcile-verified-earnings", {
      method: "POST",
    }));
    expect(response.status).toBe(401);
    expect(reconcileRecentVerifiedEarnings).not.toHaveBeenCalled();
  });

  it("runs manually with the worker secret", async () => {
    const response = await POST(new Request("https://pass.test/api/internal/reconcile-verified-earnings", {
      method: "POST",
      headers: { "x-webhook-secret": "worker-secret" },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({ ok: true, reconciled: 16 }));
  });

  it("runs from cron with the cron bearer", async () => {
    const response = await GET(new Request("https://pass.test/api/internal/reconcile-verified-earnings", {
      headers: { Authorization: "Bearer cron-secret" },
    }));
    expect(response.status).toBe(200);
    expect(reconcileRecentVerifiedEarnings).toHaveBeenCalledOnce();
  });
});
