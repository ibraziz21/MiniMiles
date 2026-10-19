import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ExpoPushTransportError,
  chunkExpoMessages,
  classifyExpoTicket,
  nativePushConfigured,
  sendExpoPushChunk,
  type ExpoPushMessage,
} from "@/lib/push/expo";

describe("classifyExpoTicket", () => {
  it("accepts a successful ticket and keeps its id for later receipt lookup", () => {
    expect(classifyExpoTicket({ status: "ok", id: "ticket-1" })).toEqual({
      status: "accepted",
      retireDevice: false,
      configError: false,
      error: null,
      ticketId: "ticket-1",
    });
  });

  it("retires a device whose app was uninstalled, and never retries it", () => {
    const outcome = classifyExpoTicket({
      status: "error",
      message: "token is not registered",
      details: { error: "DeviceNotRegistered" },
    });

    expect(outcome.status).toBe("gone");
    expect(outcome.retireDevice).toBe(true);
    expect(outcome.configError).toBe(false);
  });

  it("retries throttling without blaming the device", () => {
    const outcome = classifyExpoTicket({
      status: "error",
      message: "too many",
      details: { error: "MessageRateExceeded" },
    });

    expect(outcome.status).toBe("retry");
    expect(outcome.retireDevice).toBe(false);
  });

  it.each(["InvalidCredentials", "MismatchSenderId"])(
    "treats %s as our configuration problem, never the device's",
    (code) => {
      const outcome = classifyExpoTicket({
        status: "error",
        message: "bad credentials",
        details: { error: code },
      });

      // The distinction that matters: a credentials fault must not retire
      // every registration it touches, or one bad deploy empties the table.
      expect(outcome.configError).toBe(true);
      expect(outcome.retireDevice).toBe(false);
      expect(outcome.status).toBe("retry");
    },
  );

  it("does not retry an oversized payload, which would fail identically", () => {
    const outcome = classifyExpoTicket({
      status: "error",
      message: "too big",
      details: { error: "MessageTooBig" },
    });

    expect(outcome.status).toBe("failed");
    expect(outcome.retireDevice).toBe(false);
  });

  it("fails closed on an error code it has never seen", () => {
    const outcome = classifyExpoTicket({ status: "error", message: "mystery" });
    expect(outcome.status).toBe("failed");
    expect(outcome.retireDevice).toBe(false);
    expect(outcome.configError).toBe(false);
  });
});

describe("chunkExpoMessages", () => {
  it("splits at Expo's 100-message request limit", () => {
    const chunks = chunkExpoMessages(Array.from({ length: 250 }, (_, index) => index));
    expect(chunks.map((chunk) => chunk.length)).toEqual([100, 100, 50]);
  });

  it("returns nothing for an empty list rather than one empty request", () => {
    expect(chunkExpoMessages([])).toEqual([]);
  });
});

describe("nativePushConfigured", () => {
  const original = process.env.NATIVE_PUSH_ENABLED;
  afterEach(() => {
    process.env.NATIVE_PUSH_ENABLED = original;
  });

  it("is off unless explicitly enabled", () => {
    delete process.env.NATIVE_PUSH_ENABLED;
    expect(nativePushConfigured()).toBe(false);
    process.env.NATIVE_PUSH_ENABLED = "false";
    expect(nativePushConfigured()).toBe(false);
    process.env.NATIVE_PUSH_ENABLED = "1";
    expect(nativePushConfigured()).toBe(false);
  });

  it("is on for 'true', case- and whitespace-insensitively", () => {
    process.env.NATIVE_PUSH_ENABLED = " TRUE ";
    expect(nativePushConfigured()).toBe(true);
  });
});

describe("sendExpoPushChunk", () => {
  const message: ExpoPushMessage = { to: "ExponentPushToken[abc]", title: "t", body: "b" };

  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.EXPO_ACCESS_TOKEN;
  });

  function mockFetch(value: { ok: boolean; status: number; json?: unknown }) {
    // Params are declared so the assertions below can read the request init
    // off `mock.calls` with a type rather than a cast.
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: value.ok,
      status: value.status,
      json: async () => value.json,
    }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("returns tickets positionally aligned with the request", async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: { data: [{ status: "ok", id: "a" }, { status: "ok", id: "b" }] },
    });

    const tickets = await sendExpoPushChunk([message, { ...message, to: "ExponentPushToken[def]" }]);

    expect(tickets).toHaveLength(2);
    expect(tickets[1]).toEqual({ status: "ok", id: "b" });
  });

  it("omits the Authorization header when no access token is configured", async () => {
    const fetchMock = mockFetch({ ok: true, status: 200, json: { data: [{ status: "ok", id: "a" }] } });
    await sendExpoPushChunk([message]);

    const init = fetchMock.mock.calls[0][1];
    expect(Object.keys(init.headers as Record<string, string>)).not.toContain("Authorization");
  });

  it("sends the access token when one is configured", async () => {
    process.env.EXPO_ACCESS_TOKEN = "secret-token";
    const fetchMock = mockFetch({ ok: true, status: 200, json: { data: [{ status: "ok", id: "a" }] } });
    await sendExpoPushChunk([message]);

    const init = fetchMock.mock.calls[0][1];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-token");
  });

  it.each([
    [429, true, false],
    [503, true, false],
    [408, true, false],
    [401, true, true],
    [403, true, true],
    [400, false, false],
  ])("maps HTTP %i to retryable=%s configError=%s", async (status, retryable, configError) => {
    mockFetch({ ok: false, status });

    await expect(sendExpoPushChunk([message])).rejects.toMatchObject({
      name: "ExpoPushTransportError",
      statusCode: status,
      retryable,
      configError,
    });
  });

  it("treats a top-level errors array as a request-level configuration fault", async () => {
    mockFetch({ ok: true, status: 200, json: { errors: [{ message: "invalid project" }] } });

    await expect(sendExpoPushChunk([message])).rejects.toMatchObject({
      configError: true,
      retryable: false,
    });
  });

  it("retries rather than guessing when the ticket array cannot be aligned", async () => {
    // Two messages, one ticket: attributing that ticket to either device
    // would record a false outcome against a real registration.
    mockFetch({ ok: true, status: 200, json: { data: [{ status: "ok", id: "a" }] } });

    await expect(
      sendExpoPushChunk([message, { ...message, to: "ExponentPushToken[def]" }]),
    ).rejects.toMatchObject({ retryable: true });
  });

  it("treats a network failure as retryable and blames no device", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("socket hang up");
      }),
    );

    const error = await sendExpoPushChunk([message]).catch((err) => err);
    expect(error).toBeInstanceOf(ExpoPushTransportError);
    expect(error.retryable).toBe(true);
    expect(error.configError).toBe(false);
  });
});
