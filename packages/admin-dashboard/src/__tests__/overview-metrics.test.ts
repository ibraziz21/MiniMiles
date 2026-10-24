import { describe, expect, it, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: mocks }));
import { currentWeekStart, getHomeMetrics } from "@/lib/overviewMetrics";

beforeEach(() => { vi.resetAllMocks(); });
function countResult(count: number | null, error: unknown = null) {
  const builder = { select: vi.fn(), gte: vi.fn(), lte: vi.fn(), eq: vi.fn(), then: (resolve: (r: unknown) => void) => resolve({ count, error }) };
  for (const name of ["select", "gte", "lte", "eq"] as const) builder[name].mockReturnValue(builder);
  return builder;
}
describe("home KPI reporting", () => {
  it.each([
    ["2026-10-25T20:59:59Z", "2026-10-18T21:00:00.000Z"],
    ["2026-10-25T21:00:00Z", "2026-10-25T21:00:00.000Z"],
    ["2027-01-01T10:00:00Z", "2026-12-27T21:00:00.000Z"],
  ])("uses the Nairobi Monday boundary for %s", (now, expected) => {
    expect(currentWeekStart(new Date(now))).toBe(expected);
  });
  it("uses Pass signups, redeemed vouchers and server-side usage aggregates", async () => {
    mocks.from.mockReturnValueOnce(countResult(2000)).mockReturnValueOnce(countResult(45)).mockReturnValueOnce(countResult(120));
    mocks.rpc.mockResolvedValue({ data: { total_users_awarded: 1200, total_miles_awarded: 30000, weekly_users_awarded: 3, weekly_miles_awarded: 100, weekly_average_spend: 33.33 }, error: null });
    const result = await getHomeMetrics("super_admin", new Date("2026-10-24T10:00:00Z"));
    expect(mocks.from.mock.calls.map(args => args[0])).toEqual(["hub_user_passes", "hub_user_passes", "issued_vouchers"]);
    expect(mocks.rpc).toHaveBeenCalledWith("get_admin_usage_metrics", { p_week_start: "2026-10-18T21:00:00.000Z", p_as_of: "2026-10-24T10:00:00.000Z" });
    expect(result.metrics).toMatchObject({ total_pass_users: 2000, new_users_this_week: 45, vouchers_redeemed: 120, weekly_average_spend: 33.33 });
    expect(result.unavailable).toEqual([]);
  });
  it("does not query user analytics for a role without users.read", async () => {
    mocks.from.mockReturnValue(countResult(0));
    const { metrics } = await getHomeMetrics("finance_admin");
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from.mock.calls.every(args => args[0] === "issued_vouchers")).toBe(true);
    expect(metrics.total_pass_users).toBeUndefined();
  });
  it("distinguishes failed sources from measured zeroes", async () => {
    mocks.from.mockReturnValueOnce(countResult(0)).mockReturnValueOnce(countResult(null, { message: "offline" })).mockReturnValueOnce(countResult(0));
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "function unavailable" } });
    const { metrics, unavailable } = await getHomeMetrics("super_admin");
    expect(metrics.total_pass_users).toBe(0);
    expect(metrics.new_users_this_week).toBeUndefined();
    expect(metrics.total_miles_awarded).toBeUndefined();
    expect(unavailable).toEqual(["weekly signups", "Akiba usage"]);
  });
});
