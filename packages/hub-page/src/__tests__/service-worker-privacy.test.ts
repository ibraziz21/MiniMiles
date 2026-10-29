import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

const source = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");
function worker() {
  const handlers: Record<string, (event: any) => void> = {};
  const stores = new Map<string, Map<string, Response>>();
  const key = (request: Request | string) => typeof request === "string" ? request : request.url;
  const caches = {
    keys: async () => [...stores.keys()],
    delete: vi.fn(async (name: string) => stores.delete(name)),
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const data = stores.get(name)!;
      return { match: async (request: Request | string) => data.get(key(request))?.clone(),
        put: async (request: Request | string, response: Response) => { data.set(key(request), response.clone()); },
        delete: async (request: Request | string) => data.delete(key(request)) };
    },
  };
  const fetch = vi.fn(async () => new Response("public", { headers: { "Content-Type": "text/css" } }));
  const self = { location: { origin: "https://pass.example" },
    addEventListener: (name: string, handler: any) => { handlers[name] = handler; },
    skipWaiting: vi.fn(async () => {}), clients: { claim: vi.fn(async () => {}) } };
  vm.runInNewContext(source, { self, caches, fetch, URL, Response });
  const fire = async (type: string, request?: Request) => {
    let task: Promise<any> | undefined;
    handlers[type]({ request, waitUntil: (p: Promise<any>) => { task = p; }, respondWith: (p: Promise<any>) => { task = p; } });
    return task;
  };
  const request = (path: string, navigate = true, headers = {}) => {
    const value = new Request(`https://pass.example${path}`, { headers });
    if (navigate) Object.defineProperty(value, "mode", { value: "navigate" });
    return value;
  };
  return { caches, stores, fetch, self, fire, request };
}

describe("production service worker privacy", () => {
  it("activates immediately and purges legacy HTML and asset caches while retaining unrelated data", async () => {
    const w = worker();
    for (const name of ["akiba-pages-v1", "akiba-pages-old", "akiba-assets-v1", "unrelated-app", "akiba-public-assets-v2"]) await w.caches.open(name);
    await w.fire("install"); await w.fire("activate");
    expect(w.self.skipWaiting).toHaveBeenCalled();
    expect(await w.caches.keys()).toEqual(["unrelated-app", "akiba-public-assets-v2"]);
    expect(w.self.clients.claim).toHaveBeenCalled();
  });

  it("never stores successful private HTML and bypasses the HTTP cache", async () => {
    const w = worker();
    w.fetch.mockResolvedValue(new Response("PRIVATE-A", { headers: { "Content-Type": "text/html", "Cache-Control": "private, no-store" } }));
    expect(await (await w.fire("fetch", w.request("/vouchers/owned"))).text()).toBe("PRIVATE-A");
    expect(w.fetch).toHaveBeenCalledWith(expect.any(Request), { cache: "no-store" });
    expect(await w.caches.keys()).toEqual([]);
  });

  it.each(["/vouchers/owned", "/me", "/", "/icons/private.svg"])("offline %s cannot retrieve A's old HTML or a fallback Pass", async (path) => {
    const w = worker();
    const cache = await w.caches.open("akiba-pages-v1");
    for (const url of [path, "/me", "/"]) await cache.put(`https://pass.example${url}`, new Response("PRIVATE-A PASS"));
    w.fetch.mockRejectedValue(new TypeError("offline"));
    const response = await w.fire("fetch", w.request(path));
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).not.toContain("PRIVATE-A");
    expect(await w.caches.keys()).toEqual([]);
  });

  it.each(["/api/me/pass/token", "/auth/callback", "/vouchers/owned", "/me"])("does not intercept API/auth/RSC payloads: %s", async (path) => {
    const w = worker();
    expect(await w.fire("fetch", w.request(path, false, { RSC: "1" }))).toBeUndefined();
    expect(w.fetch).not.toHaveBeenCalled();
    expect(await w.caches.keys()).toEqual([]);
  });

  it("does not cache RSC/prefetch even when the URL resembles an asset", async () => {
    const w = worker();
    for (const headers of [{ RSC: "1" }, { "Next-Router-Prefetch": "1" }]) {
      expect(await w.fire("fetch", w.request("/_next/static/chunk.js", false, headers))).toBeUndefined();
    }
    expect(w.fetch).not.toHaveBeenCalled();
  });

  it("caches only public assets without credentials, using only its own cache", async () => {
    const w = worker();
    const old = await w.caches.open("unrelated-app");
    await old.put("https://pass.example/_next/static/style.css", new Response("PRIVATE-A", { headers: { "Content-Type": "text/css" } }));
    const request = w.request("/_next/static/style.css", false);
    expect(await (await w.fire("fetch", request)).text()).toBe("public");
    expect(w.fetch).toHaveBeenCalledWith(request, { credentials: "omit" });
    w.fetch.mockRejectedValue(new TypeError("offline"));
    expect(await (await w.fire("fetch", request)).text()).toBe("public");
    expect(w.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    { "Content-Type": "text/html" },
    { "Content-Type": "text/x-component" },
    { "Content-Type": "application/json" },
    { "Content-Type": "text/css", "Cache-Control": "private" },
    { "Content-Type": "text/css", "Cache-Control": "no-store" },
  ])("rejects private or non-asset responses on an asset path: %j", async (headers) => {
    const w = worker();
    w.fetch.mockResolvedValue(new Response("PRIVATE-A", { headers: headers as Record<string, string> }));
    await w.fire("fetch", w.request("/icons/private.svg", false));
    expect(w.stores.get("akiba-public-assets-v2")?.size).toBe(0);
  });
});
