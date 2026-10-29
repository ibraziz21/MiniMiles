import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  effect: undefined as undefined | (() => undefined | (() => void)),
  authChange: undefined as undefined | ((event: string, session: any) => void),
  unsubscribe: vi.fn(), signOut: vi.fn(), pushCleanup: vi.fn(),
  replace: vi.fn(), reload: vi.fn(), deleteCache: vi.fn(),
  events: new Map<string, (event: any) => void>(),
}));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(), useEffect: (effect: any) => { state.effect = effect; } }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: {
  onAuthStateChange: (fn: any) => { state.authChange = fn; return { data: { subscription: { unsubscribe: state.unsubscribe } } }; },
  signOut: state.signOut,
} }) }));
vi.mock("@/lib/push/browser", () => ({ cleanupPushBeforeLogout: state.pushCleanup }));
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { clearPrivateNavigationCaches } from "@/lib/privateNavigationCache";
import { SignOutButton } from "@/app/(protected)/me/SignOutButton";
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

beforeEach(() => {
  vi.clearAllMocks(); state.events.clear();
  vi.stubGlobal("React", React);
  vi.stubGlobal("window", {
    caches: { keys: async () => ["akiba-pages-v1", "akiba-assets-v1", "akiba-pages-other", "akiba-public-assets-v2", "other-app"], delete: state.deleteCache },
    location: { replace: state.replace, reload: state.reload },
    addEventListener: (name: string, fn: any) => state.events.set(name, fn),
    removeEventListener: (name: string) => state.events.delete(name),
  });
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("document", { documentElement: { style: { visibility: "visible" } } });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("ok")));
  state.signOut.mockResolvedValue({ error: null });
});

afterEach(() => vi.unstubAllGlobals());

describe("session navigation privacy", () => {
  it("purges historical page/asset caches without deleting public v2 assets or unrelated app data", async () => {
    await clearPrivateNavigationCaches();
    expect(state.deleteCache.mock.calls.map(call => call[0])).toEqual(["akiba-pages-v1", "akiba-assets-v1", "akiba-pages-other"]);
  });
  it("still lets logout finish if cache storage is unavailable", async () => {
    state.deleteCache.mockRejectedValueOnce(new Error("unavailable"));
    const button = SignOutButton();
    await button.props.onClick();
    expect(state.pushCleanup).toHaveBeenCalled();
    expect(state.signOut).toHaveBeenCalled();
    expect(state.replace).toHaveBeenCalledWith("/");
  });
  it("purges before signing out, then discards the authenticated client router", async () => {
    const button = SignOutButton(); await button.props.onClick();
    expect(state.deleteCache.mock.invocationCallOrder[0]).toBeLessThan(state.signOut.mock.invocationCallOrder[0]);
    expect(state.signOut.mock.invocationCallOrder[0]).toBeLessThan(state.replace.mock.invocationCallOrder[0]);
    expect(state.replace).toHaveBeenCalledWith("/");
  });
  it("handles cross-tab logout and account switches without reloading on token refresh", async () => {
    ServiceWorkerRegister(); const cleanup = state.effect!();
    state.authChange!("INITIAL_SESSION", { user: { id: "A" } });
    state.authChange!("TOKEN_REFRESHED", { user: { id: "A" } });
    await settle(); expect(state.reload).not.toHaveBeenCalled(); expect(state.replace).not.toHaveBeenCalled();
    state.authChange!("SIGNED_IN", { user: { id: "B" } });
    expect(document.documentElement.style.visibility).toBe("hidden");
    await settle(); expect(state.reload).toHaveBeenCalledOnce();
    state.authChange!("SIGNED_OUT", null); await settle();
    expect(state.replace).toHaveBeenCalledWith("/");
    cleanup!(); expect(state.unsubscribe).toHaveBeenCalled();
    expect(state.events.has("pageshow")).toBe(false);
  });
  it("lets a fresh sign-in complete its normal return URL without an early reload", async () => {
    ServiceWorkerRegister(); state.effect!();
    state.authChange!("INITIAL_SESSION", null);
    state.authChange!("SIGNED_IN", { user: { id: "B" } });
    await settle();
    expect(state.reload).not.toHaveBeenCalled();
    expect(state.replace).not.toHaveBeenCalled();
  });
  it("revalidates a history document restored from bfcache", () => {
    ServiceWorkerRegister(); state.effect!();
    state.events.get("pageshow")!({ persisted: false });
    expect(state.reload).not.toHaveBeenCalled();
    state.events.get("pageshow")!({ persisted: true });
    expect(document.documentElement.style.visibility).toBe("hidden");
    expect(state.reload).toHaveBeenCalledOnce();
  });
  it("registers production worker updates without the HTTP cache", () => {
    const register = vi.fn(async () => ({}));
    vi.stubGlobal("navigator", { serviceWorker: { register } });
    ServiceWorkerRegister(); state.effect!();
    expect(register).toHaveBeenCalledWith("/sw.js", { updateViaCache: "none" });
  });
});
