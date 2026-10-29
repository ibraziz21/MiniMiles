import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const hooks = vi.hoisted(() => ({ refs: [] as any[], index: 0, setup: undefined as any, deps: undefined as any }));
vi.mock("react", () => ({
  useRef: (value: any) => hooks.refs[hooks.index++] ?? (hooks.refs[hooks.index - 1] = { current: value }),
  useEffect: (setup: any, deps: any) => { if (!hooks.deps || deps[0] !== hooks.deps[0]) { hooks.setup = setup; hooks.deps = deps; } },
}));
import { useDialogA11y } from "@/hooks/useDialogA11y";
const handlers = new Map<string, any>();
let active: any, container: any, nodes: any[], mutation: any;
const element = () => ({ isConnected: true, offsetParent: {}, focus: vi.fn(function(this: any) { active = this; }), matches: () => false, closest: () => null });
beforeEach(() => {
  hooks.refs = []; hooks.index = 0; hooks.deps = undefined; handlers.clear(); nodes = []; active = element();
  container = { ...element(), querySelector: () => nodes[0], querySelectorAll: () => nodes, contains: (el: any) => el === container || nodes.includes(el) };
  vi.stubGlobal("document", { get activeElement() { return active; }, body: { style: { overflow: "auto" } },
    addEventListener: (key: string, fn: any) => handlers.set(key, fn), removeEventListener: (key: string) => handlers.delete(key) });
  vi.stubGlobal("MutationObserver", class { constructor(fn: any) { mutation = fn; } observe() {} disconnect() {} });
});
afterEach(() => vi.unstubAllGlobals());
const DialogHarness = (close?: () => void, returnRef?: any) => { hooks.index = 0; const ref = useDialogA11y(true, close, returnRef); (ref as any).current = container; return ref; };
const key = (name: string, shiftKey = false) => { const event = { key: name, shiftKey, preventDefault: vi.fn(), stopPropagation: vi.fn() }; handlers.get("keydown")(event); return event; };
describe("dialog keyboard lifecycle", () => {
  it("uses current close permission across checking, eligible, submitting and failure", () => {
    const close = vi.fn(); DialogHarness(close); const cleanup = hooks.setup();
    DialogHarness(close); key("Escape"); expect(close).toHaveBeenCalledOnce();
    DialogHarness(undefined); expect(key("Escape").preventDefault).toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce();
    DialogHarness(close); key("Escape"); expect(close).toHaveBeenCalledTimes(2); cleanup();
  });
  it("retains focus for Tab and Shift+Tab when every control is disabled", () => {
    DialogHarness(); hooks.setup();
    expect(key("Tab").preventDefault).toHaveBeenCalled(); expect(active).toBe(container);
    expect(key("Tab", true).preventDefault).toHaveBeenCalled(); expect(active).toBe(container);
  });
  it("wraps both directions and recovers focus after a state transition removes the active control", () => {
    nodes = [element(), element()]; DialogHarness(); hooks.setup(); active = nodes[1];
    key("Tab"); expect(active).toBe(nodes[0]); key("Tab", true); expect(active).toBe(nodes[1]);
    active = element(); mutation(); expect(active).toBe(container);
    key("Tab"); expect(active).toBe(nodes[0]);
  });
  it("returns focus to the success link replacing a removed claim trigger", () => {
    const returnRef = { current: element() }; DialogHarness(undefined, returnRef); const cleanup = hooks.setup();
    const link = element(); returnRef.current = link; cleanup();
    expect(link.focus).toHaveBeenCalled(); expect(document.body.style.overflow).toBe("auto");
  });
});
