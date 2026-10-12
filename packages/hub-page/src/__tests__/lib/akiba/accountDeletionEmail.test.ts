import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  completionEmailProviderName,
  isCompletionEmailConfigured,
  sendCompletionEmail,
} from "@/lib/akiba/accountDeletionEmail";

const MESSAGE = {
  to: "member@example.com",
  requestReference: "req-abc-123",
  completedAt: "2026-10-12T09:30:00.000Z",
};

const originalFetch = globalThis.fetch;

beforeEach(() => {
  delete process.env.ACCOUNT_DELETION_EMAIL_PROVIDER;
  delete process.env.RESEND_API_KEY;
  delete process.env.ACCOUNT_DELETION_EMAIL_FROM;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("completion email — configuration", () => {
  it("is off with no provider selected", () => {
    expect(isCompletionEmailConfigured()).toBe(false);
    expect(completionEmailProviderName()).toBeNull();
  });

  it("stays off for an unknown provider name rather than guessing", () => {
    process.env.ACCOUNT_DELETION_EMAIL_PROVIDER = "carrier-pigeon";
    expect(isCompletionEmailConfigured()).toBe(false);
  });

  it("reports not_configured without attempting any request", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const result = await sendCompletionEmail(MESSAGE);
    expect(result).toEqual({
      delivered: false,
      failureCode: "email_transport_not_configured",
      retryable: false,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("turns on once a provider and its key are set", () => {
    process.env.ACCOUNT_DELETION_EMAIL_PROVIDER = "resend";
    expect(isCompletionEmailConfigured()).toBe(true);
    expect(completionEmailProviderName()).toBe("resend");
  });
});

describe("completion email — resend adapter", () => {
  beforeEach(() => {
    process.env.ACCOUNT_DELETION_EMAIL_PROVIDER = "resend";
  });

  it("refuses, non-retryably, when the key is absent", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const result = await sendCompletionEmail(MESSAGE);
    expect(result).toEqual({
      delivered: false,
      failureCode: "provider_key_missing",
      retryable: false,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts the notice and reports delivery", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    expect(await sendCompletionEmail(MESSAGE)).toEqual({ delivered: true });

    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test_key");

    const payload = JSON.parse(init.body as string);
    expect(payload.to).toEqual(["member@example.com"]);
    expect(payload.subject).toMatch(/deleted/i);
    // The notice must carry the reference the member was shown, and nothing
    // that could be mistaken for a sign-in link.
    expect(payload.text).toContain("req-abc-123");
    expect(payload.text).not.toMatch(/https?:\/\//);
  });

  it("honours a configured sender", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.ACCOUNT_DELETION_EMAIL_FROM = "Akiba <notices@pass.akibamiles.com>";
    globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;

    await sendCompletionEmail(MESSAGE);
    const init = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0][1];
    expect(JSON.parse(init.body as string).from).toBe("Akiba <notices@pass.akibamiles.com>");
  });

  it("treats 5xx and 429 as retryable, and 4xx as permanent", async () => {
    process.env.RESEND_API_KEY = "re_test_key";

    for (const [status, retryable] of [
      [500, true],
      [503, true],
      [429, true],
      [401, false],
      [403, false],
      [422, false],
    ] as const) {
      globalThis.fetch = vi.fn(
        async () => new Response("{}", { status }),
      ) as unknown as typeof fetch;

      const result = await sendCompletionEmail(MESSAGE);
      expect(result).toMatchObject({
        delivered: false,
        failureCode: `provider_http_${status}`,
        retryable,
      });
    }
  });

  it("never returns the provider's response body", async () => {
    // Provider error payloads routinely echo the recipient address back, so
    // the body is not read at all.
    process.env.RESEND_API_KEY = "re_test_key";
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: "Invalid `to` field: member@example.com" }), {
          status: 422,
        }),
    ) as unknown as typeof fetch;

    const result = await sendCompletionEmail(MESSAGE);
    expect(JSON.stringify(result)).not.toContain("member@example.com");
    expect(JSON.stringify(result)).not.toContain("Invalid");
  });

  it("maps a thrown transport error to a bounded retryable code", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    globalThis.fetch = vi.fn(async () => {
      const error = new Error("connect ECONNREFUSED 1.2.3.4:443 for member@example.com");
      error.name = "TypeError";
      throw error;
    }) as unknown as typeof fetch;

    const result = await sendCompletionEmail(MESSAGE);
    expect(result).toEqual({
      delivered: false,
      failureCode: "transport_TypeError",
      retryable: true,
    });
    expect(JSON.stringify(result)).not.toContain("member@example.com");
  });
});
