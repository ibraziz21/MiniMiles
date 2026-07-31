// Partner-quest inventory (chain/partner-grouped, on-chain-task copy) is kept
// in the codebase for future paid partner inventory
// (merchant-shopping-quests-spec.md §7) but not mounted in the launch UI.
// The future partner section must use the same account-first status and
// reward ownership contract as the Hub catalog before this is re-enabled —
// do not flip it on without that work. Kept out of page.tsx: Next.js route
// files only permit a fixed export surface (default/metadata/etc.), so an
// extra named export there fails the generated route type check.
export const SHOW_PARTNER_QUESTS = false;
