// Tracks whether any form on the current page is dirty or a mutation is
// pending, so UpdateAvailableToast can refuse to reload out from under
// unsaved work (spec §11.4). No page is migrated to use this yet in Phase 1
// (pages aren't touched) — Phase 2+ pages call setDirty as they adopt forms.
// A plain module-level singleton is sufficient: this is single-tab client
// state, not data that needs to survive navigation or be shared cross-tab.

type Listener = (dirty: boolean) => void;

let dirty = false;
const listeners = new Set<Listener>();

export function setDirty(value: boolean): void {
  dirty = value;
  listeners.forEach((listener) => listener(dirty));
}

export function isDirty(): boolean {
  return dirty;
}

export function subscribeDirty(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

declare global {
  interface Window {
    __akibaAdminSetDirty?: typeof setDirty;
  }
}

// Exposed for the Playwright "service-worker update while a form is dirty"
// journey (spec §16.2) to stub dirty state without a real migrated form to drive.
if (typeof window !== "undefined") {
  window.__akibaAdminSetDirty = setDirty;
}
