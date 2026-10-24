import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: mocks }));
import { getQueueItems } from "@/lib/unifiedQueue";
import { getQueueSourceSummaries } from "@/lib/queueSources";
const tables = ["partner_settings", "merchant_visit_photos", "merchant_verified_visit_reports", "merchant_discovery_contributions"];
beforeEach(() => {
  vi.resetAllMocks();
  mocks.from.mockImplementation(() => {
    const query: Record<string, unknown> = {};
    for (const name of ["select", "eq", "is", "order", "limit"]) query[name] = vi.fn(() => query);
    query.then = (resolve: (r: unknown) => void) => resolve({ data: [], count: 0, error: null });
    return query;
  });
});
describe("current review queue", () => {
  it("queries only the four current sources", async () => {
    await getQueueItems("super_admin");
    expect(mocks.from.mock.calls.map(args => args[0])).toEqual(tables);
  });
  it("does not query discovery or merchant data for finance-only roles", async () => {
    expect(await getQueueItems("finance_admin")).toEqual([]);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("counts pending work without treating automatically verified visits as unresolved", async () => {
    const summaries = await getQueueSourceSummaries("super_admin");
    expect(mocks.from.mock.calls.map(args => args[0])).toEqual(tables.slice(0, 3));
    expect(summaries.map(s => s.label)).toEqual(["Merchant publishing", "Image review", "Report reviews"]);
  });
});
