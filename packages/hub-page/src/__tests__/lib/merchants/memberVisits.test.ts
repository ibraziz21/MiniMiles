import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  contribution: null as null | { id: string; submitted_at: string; would_recommend: boolean | null },
  contributionError: null as null | { message: string },
  photos: [] as Array<{ moderation_status: string }>,
  openRequest: null as null | { id: string },
  openRequestError: null as null | { message: string },
  contributionFilters: [] as Array<[string, unknown]>,
  photoFilters: [] as Array<[string, unknown]>,
  requestFilters: [] as Array<[string, unknown]>,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "merchant_discovery_contributions") {
        const builder: Record<string, unknown> = {};
        builder.select = () => builder;
        builder.eq = (column: string, value: unknown) => {
          state.contributionFilters.push([column, value]);
          return builder;
        };
        builder.is = (column: string, value: unknown) => {
          state.contributionFilters.push([column, value]);
          return builder;
        };
        builder.order = () => builder;
        builder.limit = () => builder;
        builder.maybeSingle = async () => ({
          data: state.contributionError ? null : state.contribution,
          error: state.contributionError,
        });
        return builder;
      }

      if (table === "merchant_visit_photos") {
        const builder: Record<string, unknown> = {};
        builder.select = () => builder;
        builder.eq = (column: string, value: unknown) => {
          state.photoFilters.push([column, value]);
          return builder;
        };
        builder.is = async (column: string, value: unknown) => {
          state.photoFilters.push([column, value]);
          return { data: state.photos, error: null };
        };
        return builder;
      }

      if (table === "discovery_contribution_requests") {
        const builder: Record<string, unknown> = {};
        builder.select = () => builder;
        builder.eq = (column: string, value: unknown) => {
          state.requestFilters.push([column, value]);
          return builder;
        };
        builder.gt = (column: string, value: unknown) => {
          state.requestFilters.push([column, value]);
          return builder;
        };
        builder.limit = () => builder;
        builder.maybeSingle = async () => ({
          data: state.openRequestError ? null : state.openRequest,
          error: state.openRequestError,
        });
        return builder;
      }

      throw new Error(`Unexpected table ${table}`);
    },
  }),
}));

const { getMemberVerifiedVisitSummary, hasOpenMerchantContributionRequest, summarizeMemberPhotoState } = await import(
  "@/lib/merchants/memberVisits"
);

describe("member verified visit summary", () => {
  beforeEach(() => {
    state.contribution = null;
    state.contributionError = null;
    state.photos = [];
    state.openRequest = null;
    state.openRequestError = null;
    state.contributionFilters = [];
    state.photoFilters = [];
    state.requestFilters = [];
  });

  it("shows the contribution entry point only for an open verified-earning request", async () => {
    state.openRequest = { id: "request-1" };

    await expect(hasOpenMerchantContributionRequest("member-1", "merchant-1")).resolves.toBe(true);
    expect(state.requestFilters).toEqual(expect.arrayContaining([
      ["hub_user_id", "member-1"],
      ["partner_id", "merchant-1"],
      ["state", "open"],
    ]));
    expect(state.requestFilters.some(([column]) => column === "expires_at")).toBe(true);
  });

  it("hides the contribution entry point when no eligible request exists or lookup fails", async () => {
    await expect(hasOpenMerchantContributionRequest("member-1", "merchant-1")).resolves.toBe(false);

    state.openRequestError = { message: "connection failed" };
    await expect(hasOpenMerchantContributionRequest("member-1", "merchant-1")).resolves.toBe(false);
  });

  it("returns the signed-in member's private saved-visit confirmation", async () => {
    state.contribution = {
      id: "contribution-1",
      submitted_at: "2026-10-01T10:00:00.000Z",
      would_recommend: true,
    };
    state.photos = [{ moderation_status: "processing" }];

    await expect(getMemberVerifiedVisitSummary("member-1", "merchant-1")).resolves.toEqual({
      id: "contribution-1",
      submittedAt: "2026-10-01T10:00:00.000Z",
      recommendation: "recommended",
      photoState: "under_review",
    });
    expect(state.contributionFilters).toEqual(expect.arrayContaining([
      ["hub_user_id", "member-1"],
      ["partner_id", "merchant-1"],
      ["withdrawn_at", null],
    ]));
    expect(state.photoFilters).toEqual(expect.arrayContaining([
      ["contribution_id", "contribution-1"],
      ["hub_user_id", "member-1"],
    ]));
  });

  it("returns no private confirmation when this member has not contributed", async () => {
    await expect(getMemberVerifiedVisitSummary("member-1", "merchant-1")).resolves.toBeNull();
  });

  it("summarizes photo moderation without exposing source files", () => {
    expect(summarizeMemberPhotoState([])).toBe("none");
    expect(summarizeMemberPhotoState([{ moderation_status: "pending" }])).toBe("under_review");
    expect(summarizeMemberPhotoState([
      { moderation_status: "rejected" },
      { moderation_status: "approved" },
    ])).toBe("approved");
    expect(summarizeMemberPhotoState([{ moderation_status: "rejected" }])).toBe("not_approved");
  });
});
