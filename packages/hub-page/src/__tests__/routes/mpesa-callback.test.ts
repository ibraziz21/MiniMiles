/**
 * Route-level tests for POST /api/payments/mpesa/callback
 *
 * Covers:
 *   - Missing MPESA_CALLBACK_SECRET env var → 500 (misconfiguration)
 *   - Missing x-mpesa-secret header → 401
 *   - Wrong x-mpesa-secret header → 401
 *   - Malformed JSON body → 400
 *   - Missing CheckoutRequestID → 400
 *   - DB write failure → 500 (so Daraja retries)
 *   - Happy path → 200
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// ── Supabase mock ─────────────────────────────────────────────────────────────
const mockUpsert = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({ upsert: mockUpsert }),
  }),
}));

// Import AFTER mock is set up
const { POST } = await import("@/app/api/payments/mpesa/callback/route");

const SECRET = "test-callback-secret";

function makeRequest(
  body: unknown,
  headers: Record<string, string> = {}
): NextRequest {
  return new NextRequest("http://localhost/api/payments/mpesa/callback", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function validBody(checkoutId = "ws_CO_test_001", resultCode = "0") {
  return {
    Body: {
      stkCallback: {
        CheckoutRequestID: checkoutId,
        MerchantRequestID: "29115-34620561-1",
        ResultCode:        Number(resultCode),
        ResultDesc:        "The service request is processed successfully.",
        CallbackMetadata: {
          Item: [
            { Name: "Amount",             Value: 1000 },
            { Name: "MpesaReceiptNumber", Value: "QK31AG3OBL" },
            { Name: "PhoneNumber",        Value: 254700000001 },
          ],
        },
      },
    },
  };
}

describe("POST /api/payments/mpesa/callback", () => {
  const originalEnv = process.env.MPESA_CALLBACK_SECRET;

  beforeEach(() => {
    mockUpsert.mockReset();
    mockUpsert.mockResolvedValue({ error: null });
    process.env.MPESA_CALLBACK_SECRET = SECRET;
  });

  afterEach(() => {
    process.env.MPESA_CALLBACK_SECRET = originalEnv;
  });

  // ── Secret enforcement ───────────────────────────────────────────────────

  it("returns 500 when MPESA_CALLBACK_SECRET is not configured", async () => {
    process.env.MPESA_CALLBACK_SECRET = "";
    const res = await POST(makeRequest(validBody(), { "x-mpesa-secret": "" }));
    expect(res.status).toBe(500);
    const json = await res.json() as { ResultCode: number };
    expect(json.ResultCode).toBe(1);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("returns 401 when x-mpesa-secret header is missing", async () => {
    const res = await POST(makeRequest(validBody()));
    expect(res.status).toBe(401);
  });

  it("returns 401 when x-mpesa-secret header is wrong", async () => {
    const res = await POST(makeRequest(validBody(), { "x-mpesa-secret": "wrong" }));
    expect(res.status).toBe(401);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  // ── Input validation ─────────────────────────────────────────────────────

  it("returns 400 when body is not valid JSON", async () => {
    const req = new NextRequest("http://localhost/api/payments/mpesa/callback", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-mpesa-secret": SECRET },
      body: "not-json{{{",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when stkCallback is missing", async () => {
    const res = await POST(makeRequest(
      { Body: {} },
      { "x-mpesa-secret": SECRET }
    ));
    expect(res.status).toBe(400);
  });

  it("returns 400 when CheckoutRequestID is missing", async () => {
    const body = validBody();
    delete (body.Body.stkCallback as Record<string, unknown>).CheckoutRequestID;
    const res = await POST(makeRequest(body, { "x-mpesa-secret": SECRET }));
    expect(res.status).toBe(400);
  });

  // ── Persistence ──────────────────────────────────────────────────────────

  it("returns 500 when DB upsert fails (so Daraja retries)", async () => {
    mockUpsert.mockResolvedValue({ error: { message: "connection timeout" } });
    const res = await POST(makeRequest(validBody(), { "x-mpesa-secret": SECRET }));
    expect(res.status).toBe(500);
    const json = await res.json() as { ResultCode: number };
    expect(json.ResultCode).toBe(1);
  });

  // ── Happy path ───────────────────────────────────────────────────────────

  it("returns 200 and upserts result on valid successful callback", async () => {
    const res = await POST(makeRequest(validBody(), { "x-mpesa-secret": SECRET }));
    expect(res.status).toBe(200);
    const json = await res.json() as { ResultCode: number };
    expect(json.ResultCode).toBe(0);
    expect(mockUpsert).toHaveBeenCalledOnce();
    const upsertArg = mockUpsert.mock.calls[0][0] as Record<string, unknown>;
    expect(upsertArg.checkout_request_id).toBe("ws_CO_test_001");
    expect(upsertArg.result_code).toBe("0");
    expect(upsertArg.receipt_number).toBe("QK31AG3OBL");
    expect(upsertArg.amount_kes).toBe(1000);
  });

  it("stores failed callback result (ResultCode != 0)", async () => {
    // Real M-Pesa failure callbacks omit CallbackMetadata entirely.
    const failBody = {
      Body: {
        stkCallback: {
          CheckoutRequestID: "ws_CO_fail_001",
          MerchantRequestID: "29115-34620561-1",
          ResultCode:        1032,
          ResultDesc:        "Request cancelled by user",
          // No CallbackMetadata — receipt/amount/phone are absent on failure
        },
      },
    };
    const res = await POST(makeRequest(failBody, { "x-mpesa-secret": SECRET }));
    expect(res.status).toBe(200);
    const upsertArg = mockUpsert.mock.calls[0][0] as Record<string, unknown>;
    expect(upsertArg.result_code).toBe("1032");
    expect(upsertArg.receipt_number).toBeNull();
  });
});
