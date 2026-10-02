import { afterEach, describe, expect, it } from "vitest";
import { isSameOriginRequest } from "@/lib/push/origin";

const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

afterEach(() => {
  if (originalSiteUrl === undefined) {
    delete process.env.NEXT_PUBLIC_SITE_URL;
  } else {
    process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
  }
});

describe("isSameOriginRequest", () => {
  it("accepts a direct same-origin request", () => {
    const request = new Request("https://hub.akibamiles.com/api/me/test", {
      headers: { origin: "https://hub.akibamiles.com" },
    });

    expect(isSameOriginRequest(request)).toBe(true);
  });

  it("accepts the public Host header when Request.url contains an internal proxy host", () => {
    const request = new Request("http://internal:3000/api/me/test", {
      headers: {
        origin: "https://preview-hub.vercel.app",
        host: "preview-hub.vercel.app",
      },
    });

    expect(isSameOriginRequest(request)).toBe(true);
  });

  it("accepts X-Forwarded-Host from a proxy chain", () => {
    const request = new Request("http://internal:3000/api/me/test", {
      headers: {
        origin: "https://preview-hub.vercel.app",
        host: "internal:3000",
        "x-forwarded-host": "preview-hub.vercel.app, edge.internal",
      },
    });

    expect(isSameOriginRequest(request)).toBe(true);
  });

  it("accepts the explicitly configured site host", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://hub.akibamiles.com";
    const request = new Request("http://internal:3000/api/me/test", {
      headers: { origin: "https://hub.akibamiles.com" },
    });

    expect(isSameOriginRequest(request)).toBe(true);
  });

  it("rejects missing, malformed, and genuinely foreign origins", () => {
    expect(isSameOriginRequest(new Request("https://hub.akibamiles.com/api/me/test"))).toBe(false);

    const malformed = new Request("https://hub.akibamiles.com/api/me/test", {
      headers: { origin: "not a url" },
    });
    expect(isSameOriginRequest(malformed)).toBe(false);

    process.env.NEXT_PUBLIC_SITE_URL = "https://hub.akibamiles.com";
    const foreign = new Request("http://internal:3000/api/me/test", {
      headers: {
        origin: "https://attacker.example",
        host: "hub.akibamiles.com",
        "x-forwarded-host": "hub.akibamiles.com",
      },
    });
    expect(isSameOriginRequest(foreign)).toBe(false);
  });
});
