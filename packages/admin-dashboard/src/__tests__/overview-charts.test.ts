import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: mock }));
import { getOverviewCharts, overviewDays } from "@/lib/overviewCharts";

beforeEach(() => {
  vi.resetAllMocks();
  mock.rpc.mockResolvedValue({
    data: { merchants: [], daily: [] },
    error: null,
  });
});

function query(result: {
  data?: unknown[] | null;
  error?: unknown;
  count?: number | null;
}) {
  const builder: Record<string, unknown> = {
    then: (resolve: (value: unknown) => void) =>
      resolve({ data: [], error: null, ...result }),
  };
  for (const method of ["select", "order", "range", "in", "eq"])
    builder[method] = vi.fn(() => builder);
  return builder;
}

describe("overview analytics sources", () => {
  it("normalises period input", () => {
    expect(overviewDays("7")).toBe(7);
    expect(overviewDays("90")).toBe(90);
    for (const value of [undefined, "bad", ["7"], "-1"])
      expect(overviewDays(value)).toBe(30);
  });
  it("uses Nairobi dates across a UTC day boundary", async () => {
    mock.from.mockReturnValue(query({ count: 0 }));
    const data = await getOverviewCharts(
      "super_admin",
      7,
      new Date("2026-11-08T22:00:00Z")
    );
    expect(data.from).toBe("2026-11-03");
    expect(data.to).toBe("2026-11-09");
    expect(mock.rpc).toHaveBeenCalledWith("get_admin_pass_analytics", {
      p_from: "2026-11-03",
      p_to: "2026-11-09",
    });
  });
  it("does not fetch user or merchant analytics for finance roles", async () => {
    mock.from.mockReturnValue(query({}));
    const data = await getOverviewCharts("finance_admin", 30);
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(data.passes).toBeNull();
    expect(data.activeMerchants).toBeNull();
    expect(mock.from.mock.calls.every(([name]) => name.startsWith("v_"))).toBe(
      true
    );
  });
  it("sums every financial page and converts minor units once", async () => {
    let payablePage = 0;
    mock.from.mockImplementation((table: string) => {
      if (table === "partners") return query({ count: 2 });
      if (table === "v_unbatched_voucher_payables")
        return query({
          data:
            payablePage++ === 0
              ? Array.from({ length: 500 }, () => ({ net_payable_minor: 100 }))
              : [{ net_payable_minor: 200 }],
        });
      return query({ data: [{ total_amount_minor: 300 }] });
    });
    const data = await getOverviewCharts("super_admin", 30);
    expect(data.finance).toEqual({ outstanding: 505, paid: 3 });
    expect(payablePage).toBe(2);
  });
  it("never presents failed finance queries as zero", async () => {
    mock.from.mockReturnValue(
      query({ data: null, error: { message: "offline" }, count: null })
    );
    mock.rpc.mockResolvedValue({ data: null, error: { message: "offline" } });
    const data = await getOverviewCharts("super_admin", 30);
    expect(data.finance).toBeNull();
    expect(data.passes).toBeNull();
    expect(data.merchants).toBeNull();
    expect(data.activeMerchants).toBeNull();
  });
});
