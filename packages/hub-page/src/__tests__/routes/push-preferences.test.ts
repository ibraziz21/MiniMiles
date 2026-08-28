import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  upsert: vi.fn(),
}));

vi.mock("@/lib/push/origin", () => ({ isSameOriginRequest: () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ upsert: state.upsert }) }),
}));

const route = await import("@/app/api/me/push/preferences/route");

function request(body: Record<string, unknown>) {
  return new Request("https://pass.akibamiles.com/api/me/push/preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Origin: "https://pass.akibamiles.com" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/me/push/preferences", () => {
  beforeEach(() => {
    state.user = { id: "user-1" };
    state.upsert.mockReset();
    state.upsert.mockResolvedValue({ error: null });
  });

  it("stores explicit marketing consent", async () => {
    const response = await route.PATCH(request({ marketing: true }));
    expect(response.status).toBe(200);
    expect(state.upsert).toHaveBeenCalledWith(
      { hub_user_id: "user-1", marketing_enabled: true },
      { onConflict: "hub_user_id" },
    );
  });

  it("allows consent to be withdrawn", async () => {
    const response = await route.PATCH(request({ marketing: false }));
    expect(response.status).toBe(200);
    expect(state.upsert).toHaveBeenCalledWith(
      { hub_user_id: "user-1", marketing_enabled: false },
      { onConflict: "hub_user_id" },
    );
  });

  it("stores explicit earnings consent", async () => {
    const response = await route.PATCH(request({ earnings: false }));
    expect(response.status).toBe(200);
    expect(state.upsert).toHaveBeenCalledWith(
      { hub_user_id: "user-1", earnings_enabled: false },
      { onConflict: "hub_user_id" },
    );
  });

  it("rejects unknown or non-boolean preferences", async () => {
    expect((await route.PATCH(request({ sms: true }))).status).toBe(400);
    expect((await route.PATCH(request({ marketing: "yes" }))).status).toBe(400);
    expect(state.upsert).not.toHaveBeenCalled();
  });
});
