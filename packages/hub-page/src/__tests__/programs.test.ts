/**
 * Unit tests for issueVoucherFromProgram service.
 * All Supabase interactions are mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mockRpc }),
}));

Object.defineProperty(globalThis, "crypto", {
  value: { getRandomValues: (buf: Uint8Array) => { buf.fill(7); return buf; } },
  configurable: true,
});

const { issueVoucherFromProgram } = await import("@/lib/vouchers/programs");

const BASE_INPUT = {
  programId:        "prog-uuid",
  channel:          "claw" as const,
  sourceRef:        "claw:42220:0xcontract:session-123:456",
  recipientAddress: "0xabc",
  hubUserId:        "user-uuid",
  evidence:         { session_id: "session-123" },
  actorId:          "user-uuid",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("issueVoucherFromProgram", () => {
  it("returns voucherId and code on success", async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ ok: true, voucher_id: "v-001", code: "TESTCODE1", error_code: "" }],
      error: null,
    });

    const result = await issueVoucherFromProgram(BASE_INPUT);

    expect(result.ok).toBe(true);
    expect(result.voucherId).toBe("v-001");
    expect(result.code).toBe("TESTCODE1");
    expect(mockRpc).toHaveBeenCalledWith(
      "issue_voucher_from_program",
      expect.objectContaining({
        p_program_id:  "prog-uuid",
        p_channel:     "claw",
        p_source_ref:  "claw:42220:0xcontract:session-123:456",
        p_hub_user_id: "user-uuid",
      })
    );
  });

  it("does NOT send p_sponsor or p_funding_type to the RPC", async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ ok: true, voucher_id: "v-001", code: "TESTCODE1", error_code: "" }],
      error: null,
    });

    await issueVoucherFromProgram(BASE_INPUT);

    const call = mockRpc.mock.calls[0][1] as Record<string, unknown>;
    expect(call).not.toHaveProperty("p_sponsor");
    expect(call).not.toHaveProperty("p_funding_type");
  });

  it("maps TOTAL_CAP_EXCEEDED to 409", async () => {
    mockRpc.mockResolvedValueOnce({
      data:  null,
      error: { message: "TOTAL_CAP_EXCEEDED" },
    });

    const result = await issueVoucherFromProgram(BASE_INPUT);

    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(409);
    expect(result.error).toMatch(/no vouchers remaining/i);
  });

  it("maps SOURCE_REF_CONFLICT to 409", async () => {
    mockRpc.mockResolvedValueOnce({
      data:  null,
      error: { message: "SOURCE_REF_CONFLICT: hub_user_id mismatch" },
    });

    const result = await issueVoucherFromProgram(BASE_INPUT);

    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(409);
    expect(result.error).toMatch(/claimed by a different account/i);
  });

  it("maps PROGRAM_NOT_ACTIVE to 409", async () => {
    mockRpc.mockResolvedValueOnce({
      data:  null,
      error: { message: "PROGRAM_NOT_ACTIVE: state=paused" },
    });

    const result = await issueVoucherFromProgram(BASE_INPUT);

    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(409);
  });

  it("maps PROGRAM_NOT_FOUND to 404", async () => {
    mockRpc.mockResolvedValueOnce({
      data:  null,
      error: { message: "PROGRAM_NOT_FOUND" },
    });

    const result = await issueVoucherFromProgram(BASE_INPUT);

    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(404);
  });

  it("maps CHANNEL_CAP_EXCEEDED to 409", async () => {
    mockRpc.mockResolvedValueOnce({
      data:  null,
      error: { message: "CHANNEL_CAP_EXCEEDED" },
    });

    const result = await issueVoucherFromProgram(BASE_INPUT);

    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(409);
    expect(result.error).toMatch(/channel/i);
  });

  it("maps NO_LINKED_WALLET to 400", async () => {
    mockRpc.mockResolvedValueOnce({
      data:  null,
      error: { message: "NO_LINKED_WALLET: hub_user_id=..." },
    });

    const result = await issueVoucherFromProgram(BASE_INPUT);

    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
    expect(result.error).toMatch(/wallet/i);
  });

  it("maps TEMPLATE_EXPIRED to 409", async () => {
    mockRpc.mockResolvedValueOnce({
      data:  null,
      error: { message: "TEMPLATE_EXPIRED" },
    });

    const result = await issueVoucherFromProgram(BASE_INPUT);

    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(409);
  });

  it("returns 500 for unknown RPC errors", async () => {
    mockRpc.mockResolvedValueOnce({
      data:  null,
      error: { message: "connection refused" },
    });

    const result = await issueVoucherFromProgram(BASE_INPUT);

    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(500);
  });

  it("accepts recipientAddress without hubUserId", async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ ok: true, voucher_id: "v-003", code: "CODE3", error_code: "" }],
      error: null,
    });

    const result = await issueVoucherFromProgram({
      ...BASE_INPUT,
      hubUserId: undefined,
      recipientAddress: "0xwallet",
    });

    expect(result.ok).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith(
      "issue_voucher_from_program",
      expect.objectContaining({
        p_recipient_address: "0xwallet",
        p_hub_user_id:       null,
      })
    );
  });
});
