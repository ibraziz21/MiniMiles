# Akiba Pass — store release checklist

AKIBA-MOB-002 §12, §16, §17, §18. Every row needs a named owner and a date
before submission. Rows marked **BLOCKED** cannot be completed by
engineering alone — see §20 of the spec.

Status key: `done` · `blocked` · `todo`

## Identity and accounts

| Item | Status | Owner | Date | Note |
|---|---|---|---|---|
| Final iOS bundle identifier | **blocked** | Product | | `app.json` still carries `com.akiba.pass`; immutable after publication |
| Final Android package name | **blocked** | Product | | Same |
| `extra.configurationNotes.bundleIdentifiersArePlaceholders` removed | blocked | Product | | Remove only when the two rows above are decided |
| Apple Developer account + team, credential owner | **blocked** | Operations | | Record in the private ops runbook, not in Git |
| Google Play developer account, credential owner | **blocked** | Operations | | Same |
| Expo organization account, `expo.owner`, `extra.eas.projectId` | **blocked** | Operations | | `eas init` writes these |
| App Store Connect app record, display name "Akiba Pass" | blocked | Product | | |
| Play Console app record, display name "Akiba Pass" | blocked | Product | | |

## Build configuration

| Item | Status | Owner | Date | Note |
|---|---|---|---|---|
| `eas.json` with development / preview / production / submit | done | Engineering | 2026-10-10 | `submit.production` intentionally empty — needs store ids |
| `cli.appVersionSource: remote`, production `autoIncrement` | done | Engineering | 2026-10-10 | §11.4 |
| `cli.requireCommit: true` | done | Engineering | 2026-10-10 | §11.2 |
| EAS Update disabled (`updates.enabled: false`, no channels) | done | Engineering | 2026-10-10 | §11.4 |
| `userInterfaceStyle: "light"` | done | Engineering | 2026-10-10 | §4.10 — v1 has no dark token set |
| `platforms: ["ios", "android"]`, web output removed | done | Engineering | 2026-10-10 | §4.9 |
| `expo-dev-client` installed for the development profile | done | Engineering | 2026-10-10 | §11.2 |
| EAS environment variables for development / preview / production | **blocked** | Operations | | Needs the production Supabase and API hosts |
| Production build fails closed on a non-production host | **todo** | Engineering | | Absent-value check exists; host assertion does not — see `docs/eas-configuration.md` |
| Expo SDK package versions aligned (`expo install --fix`) | done | Engineering | 2026-10-10 | `expo-doctor` 21/21 |
| Node version matches `engines` (`>=22.13.0`) | **todo** | Engineering | | Local runs are on Node 20.19.1, so lint/typecheck/tests have not been exercised on the declared runtime |

## Assets and fonts

| Item | Status | Owner | Date | Note |
|---|---|---|---|---|
| 1024×1024 app icon source | **blocked** | Brand | | `assets/images/icon.png` is 512×512 |
| Android adaptive foreground + monochrome layers | **blocked** | Brand | | Foreground is 512×512; no monochrome layer exists |
| Splash validated from a preview/production build | todo | Engineering | | Not valid to check in Expo Go (§11.5) |
| FT Sterling production licence evidence **or** replacement family | **blocked** | Brand / Legal | | `assets/fonts/FTSterlingTrial-*.otf` are trial files and cannot ship. Replacing the family means updating `fontFamily.sterling*` in `src/design-system/tokens.ts` — one file, every heading |
| Store screenshots, small and large phone, both platforms | blocked | Product / Marketing | | Must match the reviewed binary |
| Feature graphic and promotional copy | blocked | Marketing | | |

## Legal, privacy and deletion

| Item | Status | Owner | Date | Note |
|---|---|---|---|---|
| Retention inventory approved (no `TBD` row) | **blocked** | Legal / Data protection | | **13 of 21** rows unapproved — `src/lib/akiba/accountDeletionPolicy.ts` in hub-page. Three are schema conflicts, not missing periods: `published_photos` (append-only `discovery_moderation_audit_events.photo_id`), `unpublished_contributions` (chained behind it), `pass_credentials` (`hub_referrals.referred_pass_id`). `skill_game_prizes` was found by the static FK check, not by hand |
| Deletion submission enabled (`ACCOUNT_DELETION_SUBMISSION_ENABLED`) | **blocked** | Legal / Operations | | Off by default, and gated on the inventory. Until it is on, the app and the public page show the support fallback instead of a Continue button — requests are *refused*, not accepted-and-stranded |
| Deletion processing enabled (`ACCOUNT_DELETION_PROCESSING_ENABLED`) | **blocked** | Operations | | Off by default. Acceptance is gated on the same conditions, so the two cannot disagree |
| Completion-email transport | **blocked** | Engineering / Operations | | No email provider exists in hub-page. `isCompletionEmailConfigured()` returns false, so the delivery pass is skipped rather than burning retries; `account_deletion_reconciliation.completion_email_pending_count` surfaces the backlog |
| 14-day processing target and legal-hold copy approved | **blocked** | Legal / Support | | Published in the app and on `/account-deletion` |
| Privacy policy updated for the mobile app + deletion + on-chain | **todo** | Legal | | `packages/hub-page/src/content/legal.ts` and `packages/website/src/content/legal.ts` must change together |
| Terms updated for deletion effect on Pass/vouchers/Miles | **todo** | Legal | | Same two files |
| `/account-deletion` live over production HTTPS, returns 200 anonymous | done (code) | Engineering | 2026-10-10 | Page and flow implemented; URL verification is a deploy step |
| Deletion URL entered in Play Console | blocked | Operations | | |
| Deletion URL set as Apple User Privacy Choices URL | blocked | Operations | | Optional but recommended |
| Apple privacy declarations reconciled with the binary | **todo** | Engineering / Legal | | Worksheet: `docs/store-release/privacy-data-map.md` |
| Play Data safety form completed independently | **todo** | Engineering / Legal | | Same worksheet |
| Link check: privacy, terms, deletion, support | todo | Engineering | | §6 |

## Review metadata

| Item | Status | Owner | Date | Note |
|---|---|---|---|---|
| Listing copy, keywords, category | blocked | Product | | `docs/store-release/metadata.md` |
| Kenya-only availability for first rollout | blocked | Product | | §12 |
| Age rating / target audience consistent with 18+ Terms | blocked | Product / Legal | | |
| Review notes: OTP login, location, Pass QR, Miles, vouchers, no cash-out | todo | Product | | Draft in `metadata.md` |
| Durable review account or review-safe OTP procedure | **blocked** | Engineering / Support | | Reviewers cannot receive a member's email OTP |
| Export compliance, content rights, advertising, financial declarations | blocked | Legal | | |
| No mention of Gifts, Games, raffles, or push anywhere in the listing | todo | Product | | Gifts is hidden by `features.gifts` in the production config |

## Verification (§15.4)

Run from a clean checkout:

```bash
pnpm --filter @akiba/akiba-app lint
pnpm --filter @akiba/akiba-app typecheck
pnpm --filter @akiba/akiba-app test
pnpm --filter @akibamiles/hub-page test
pnpm --filter @akibamiles/hub-page build
pnpm --dir packages/akiba-app dlx expo-doctor@latest
```

Database integration tests (require a local PostgreSQL):

```bash
pnpm --filter @akibamiles/hub-page test:integration
```

`src/__tests__/integration/account-deletion-workflow.test.ts` covers
migration 097 against real Postgres — RLS and grants, the single-live-challenge
index, first-request-wins under concurrency, lease claiming and reclaiming,
constrained status transitions, the completion-email queue with backoff and
give-up, and the refusal to hard-delete an Auth user that a request references.
It found an ambiguous `status` reference in `create_account_deletion_request`
that the mocked tests could not see and that would have failed on the first
production call.

`src/__tests__/lib/akiba/accountDeletionStepOrder.test.ts` parses the real
migration SQL and checks the worker's step order against the actual foreign-key
graph. It found three ordering defects and one entirely missing data class.

Still **todo**, none of which can run without store credentials and real
devices: `expo export` for both platforms, `next build` for hub-page against a
fully configured production environment, EAS preview and production builds,
signed-artifact inspection, Maestro execution (`.maestro/flows`, plus the
`.maestro/scripts/` wrappers that assert server state), and the §15.5
physical-device matrix.

## Evidence to attach to the release ticket (§18)

- [ ] Approved retention inventory and its policy version
- [ ] API/database test output and worker reconciliation output
- [ ] Before/after fixture inventory for one fully processed account
- [ ] Maestro run output and the physical-device checklist
- [ ] Resolved Expo config per EAS profile, values redacted
- [ ] EAS build URLs and artifact inspection notes
- [ ] App Store Connect and Play Console privacy/deletion screenshots
- [ ] Production link-check output
- [ ] Font licence reference or the replacement decision
- [ ] Signed-off store copy and screenshots
- [ ] Named rollback/incident owner and support escalation path
