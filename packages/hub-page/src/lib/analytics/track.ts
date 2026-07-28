"use client";

// Minimal client-side analytics hook-point — no provider is wired into this
// app yet (no PostHog key, no existing track() convention found anywhere in
// this codebase). This exists so the home-redesign spec's §7 events have one
// call site to swap for a real provider later, instead of each component
// inventing its own ad hoc logging.
//
// In dev, events log to the console so they're visible while building;
// in production this is a deliberate no-op until a provider is configured.
export function track(event: string, props?: Record<string, unknown>): void {
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.debug("[track]", event, props ?? {});
  }
  // TODO: forward to the chosen analytics provider once one is configured
  // for hub-page (e.g. window.posthog?.capture(event, props)).
}
