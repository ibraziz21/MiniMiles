import { afterEach, describe, expect, it, vi } from "vitest";

const mockFrom = vi.fn();

vi.mock("@/lib/supabaseClient", () => ({
  supabase: { from: (table: string) => mockFrom(table) },
}));

describe("GET /api/admin/merchant-quests/health", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ADMIN_QUEUE_SECRET;
  });

  it("requires the admin secret as a Bearer token", async () => {
    process.env.ADMIN_QUEUE_SECRET = "rollout-secret";
    const { GET } = await import(
      "@/app/api/admin/merchant-quests/health/route"
    );

    const response = await GET(
      new Request("http://localhost/api/admin/merchant-quests/health"),
    );

    expect(response.status).toBe(401);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("rejects an invalid observation window before querying data", async () => {
    process.env.ADMIN_QUEUE_SECRET = "rollout-secret";
    const { GET } = await import(
      "@/app/api/admin/merchant-quests/health/route"
    );

    const response = await GET(
      new Request(
        "http://localhost/api/admin/merchant-quests/health?hours=169",
        { headers: { Authorization: "Bearer rollout-secret" } },
      ),
    );

    expect(response.status).toBe(400);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
