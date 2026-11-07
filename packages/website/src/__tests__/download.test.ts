import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, HEAD } from "@/app/download/route";
import { APP_STORE_URL } from "@/content/site";

afterEach(() => vi.restoreAllMocks());

function request(ua: string, query = "") {
  return new Request(`https://akibamiles.com/download${query}`, {
    headers: { "user-agent": ua },
  });
}

describe("download redirects", () => {
  it.each(["iPhone OS 26", "iPad; CPU OS 26", "iPod"])("sends %s to Apple's listing", (ua) => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const response = GET(request(ua));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(APP_STORE_URL);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("User-Agent");
  });

  it("preserves merchant attribution in the Play referrer without accepting a redirect URL", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const response = GET(request("Android 16", "?source=merchant&ref=arabica&url=https://evil.example"));
    const destination = new URL(response.headers.get("location")!);
    expect(destination.hostname).toBe("play.google.com");
    expect(destination.searchParams.get("id")).toBe("com.akibamiles.akiba");
    const referrer = new URLSearchParams(destination.searchParams.get("referrer")!);
    expect(referrer.get("utm_source")).toBe("merchant");
    expect(referrer.get("utm_content")).toBe("arabica");
    expect(destination.searchParams.has("url")).toBe(false);
  });

  it.each(["", "Windows NT", "Macintosh; Intel Mac OS X", "Googlebot Android", "facebookexternalhit iPhone"])(
    "offers both stores for unknown devices and previews (%s)", (ua) => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const response = GET(request(ua, "?source=merchant&ref=flame"));
      expect(response.headers.get("location")).toBe("https://akibamiles.com/download/options?source=merchant&ref=flame");
    },
  );

  it("honors a manual store choice regardless of device and logs only allowed campaign slugs", () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const response = GET(request("Android", "?store=ios&source=merchant&ref=arabica&email=private@example.com"));
    expect(response.headers.get("location")).toBe(APP_STORE_URL);
    expect(JSON.parse(log.mock.calls[0][0])).toEqual({
      event: "download_visit",
      platform: "ios",
      selection: "manual",
      campaign: { source: "merchant", ref: "arabica" },
    });
  });

  it("does not count HEAD requests as visits", () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(HEAD(request("Android")).status).toBe(302);
    expect(log).not.toHaveBeenCalled();
  });

  it("ignores malformed campaign tags and arbitrary store destinations", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const response = GET(request("", "?store=https://evil.example&ref=%0Aprivate%40example.com"));
    expect(response.headers.get("location")).toBe("https://akibamiles.com/download/options");
  });
});
