// Client-side trigger for POST /api/quests/proof (hub-quest-event-delivery-spec.md
// §8.1 "Deal-view proof completion"). Fire-and-forget by design — a genuine
// offer interaction (opening a detail, the primary action, or the
// merchant-offer link) must never be blocked or delayed by this call, and
// repeat calls for the same offer are safe no-ops (server-side uniqueness on
// hub_user_id + quest_key + offer id). `keepalive` keeps the request alive
// through the merchant-link case, where the browser navigates away
// immediately after the click.
export function recordDealViewProof(offerId: string): void {
  fetch("/api/quests/proof", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ offerId }),
    keepalive: true,
  }).catch(() => {
    // Best-effort — the member must never be blocked from viewing an offer
    // because proof recording failed (spec §8.2).
  });
}
