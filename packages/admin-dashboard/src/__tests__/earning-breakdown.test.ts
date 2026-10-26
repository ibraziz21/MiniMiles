import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: mocks }));
import { earningFilters, formatSpendKes, getEarningBreakdown, isMerchantKey } from "@/lib/earningBreakdown";

beforeEach(() => vi.resetAllMocks());
describe("earning drill-down", () => {
  it("passes a Nairobi week boundary and selected merchant to the aggregate RPC", async () => {
    mocks.rpc.mockResolvedValue({ data: { total_rows: 1 }, error: null });
    await getEarningBreakdown("week", 2, "11111111-1111-1111-1111-111111111111", new Date("2026-10-25T21:15:00Z"));
    expect(mocks.rpc).toHaveBeenCalledWith("get_admin_earning_breakdown", {
      p_from: "2026-10-25T21:00:00.000Z", p_as_of: "2026-10-25T21:15:00.000Z",
      p_merchant_key: "11111111-1111-1111-1111-111111111111", p_page: 2,
    });
  });
  it("does not apply a date floor to all-time reporting", async () => {
    mocks.rpc.mockResolvedValue({ data: { total_rows: 0, merchants: [] }, error: null });
    const result = await getEarningBreakdown("all", 1);
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_from: null, p_merchant_key: null, p_page: 1 });
    expect(result.error).toBe(false);
  });
  it("distinguishes unavailable RPC data from an empty report", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "unavailable" } });
    expect(await getEarningBreakdown("all", 1)).toEqual({ data: null, error: true });
  });
  it.each(["0", "-1", "nope", "1.5", "10001"])("normalizes invalid page %s", page => {
    expect(earningFilters({ page, period: "wrong" })).toEqual({ page: 1, period: "all" });
  });
  it("accepts valid filters and rejects malformed merchant identifiers", () => {
    expect(earningFilters({ page: "3", period: "week" })).toEqual({ page: 3, period: "week" });
    expect(isMerchantKey("unattributed")).toBe(true);
    expect(isMerchantKey("11111111-1111-1111-1111-111111111111")).toBe(true);
    expect(isMerchantKey("invalid")).toBe(false);
  });
  it("formats the supplied KES spend value with the locale's separators", () => {
    expect(formatSpendKes(123 * 100)).toBe("KES 12,300");
    expect(formatSpendKes(0)).toBe("KES 0");
  });
});
