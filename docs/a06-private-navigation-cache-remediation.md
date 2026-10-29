# A06: private navigation cache isolation

Status on 29 October 2026: **implemented and verified in a real Chromium browser using the exact production worker; production deployment pending**.

## Changed behavior

[The production worker](/Users/ibraziz21/Desktop/Work/MiniMiles/packages/hub-page/public/sw.js) never stores navigation HTML. Navigation fetches bypass the HTTP cache with `cache: 'no-store'`. On network failure it returns a neutral, non-cacheable HTTP503 reconnect page, with no account identity, Pass, voucher metadata, QR canvas or serialized application state. There is no fallback to another cached page.

RSC/prefetch, API and auth requests are not intercepted or persisted. Public static assets alone may use `akiba-public-assets-v2`: a restricted URL set, credential-free fetches, successful non-redirected responses, an asset content type, and no `private`/`no-store` directive. Asset lookups are scoped to this cache; the worker never searches global Cache Storage. A navigation to an asset-looking URL still takes the uncached navigation path.

Activation waits for deletion of all historical `akiba-*` caches except the new public-asset cache before claiming clients. This includes both `akiba-pages-v1` and the previous `akiba-assets-v1`, whose permissive asset matcher could have stored HTML. Navigation repeats the purge to catch legacy entries left by older clients. Unrelated application caches are preserved.

[Session cleanup](/Users/ibraziz21/Desktop/Work/MiniMiles/packages/hub-page/src/lib/privateNavigationCache.ts) also purges historical caches on page startup, logout and account change. Logout retains push-subscription and referral-attribution cleanup and replaces the document instead of retaining Next's authenticated router state. Existing signed-in views are immediately hidden and reloaded on cross-tab logout/account switching. A document restored from bfcache is hidden and revalidated. Fresh anonymous-to-signed-in transitions retain the normal login return flow, avoiding an early reload before auth cookies finish flushing.

Worker registration uses `updateViaCache: 'none'`; `/sw.js` is served with `Cache-Control: no-store, max-age=0`. Development registration remains disabled. Web-push handlers are retained.

**Offline product change:** the previous offline Pass depended on storing a private page in a shared cache. It is deliberately removed. Offline navigation now requires reconnection. An offline Pass needs a separate design that binds its data to the signed-in account; this repair does not implement one.

## Real-browser evidence

Dedicated Chromium profile `a06privacy`, one origin `http://127.0.0.1:4103`, real Hub authentication against synthetic Supabase branch `urjamfbtlzycetvuvwpg`:

1. Signed in synthetic member 2 (A) and loaded A's owned voucher online.
2. Seeded historical `akiba-pages-v1` and `akiba-assets-v1` with explicitly private/no-store A-marked HTML for the voucher, `/me` and `/`.
3. Registered `/sw.js`, waited for activation/control, and verified both historical caches were gone. Reloaded A's real voucher successfully online.
4. Opened a second authenticated tab, then used the real Settings **Sign out** button. Auth cookies were removed; the other tab discarded its private view and navigated home. Cache Storage contained ten public asset entries and no HTML/RSC.
5. Disabled network at the browser-context level. The old voucher, `/me` and `/` all returned neutral HTTP503 pages; Back navigation exposed no A content.
6. Reconnected and signed in member 3 (B) in the **same browser profile**. B's own voucher loaded online; A's voucher returned HTTP404. A real RSC request returned HTTP200 `text/x-component` online without being persisted.
7. Disabled network again. Both A's and B's voucher URLs, `/me` and `/` returned neutral HTTP503 with no identity, voucher ID or QR. An offline RSC request failed instead of replaying cached data.
8. Reconnected and signed out B for cleanup. No voucher claim/redemption or financial mutation was performed.

The worker fetched from the browser had SHA-256 `ba6d01cc78cd54b244311e2aed50393206399640b4555f391f00aa5200ca92d2`, matching the production source file byte for byte. The active controller URL was `/sw.js`, and its response header was `no-store, max-age=0`.

**Scope:** the browser used the existing development Hub UI with this exact production worker manually registered, bypassing development-only registration suppression for the test. This was not a full `next build`/production-server or deployed-origin test. The activation check seeded historical caches; it did not install a running old worker first. Browser evidence is Chromium only. Successful logout was online, followed by offline navigation; offline auth-server revocation was not tested or added.

Private/redacted evidence is ignored under `.verification/a06-upgrade-browser-result.txt`, `.verification/a06-logout-browser-result.txt`, `.verification/a06-second-user-browser-result.txt`. A neutral-page screenshot is at `output/playwright/a06-offline-isolation.png`.

## Automated verification

- **24 new privacy tests pass**: 17 against the actual production worker source in a VM, seven covering session cleanup, logout order, cross-tab identity changes, fresh sign-in, bfcache and registration behavior.
- **Full Hub unit run:** 1,104 passed, one skipped, one known pre-existing account-deletion failure (the test expects the old support email; the implementation uses the new one). No new privacy failure remains.
- Hub TypeScript check passed; changed-file whitespace checks passed.
- Negative control against the original worker reproduced the defect: it stored private/no-store A HTML and returned it on offline navigation. The original audit evidence was preserved separately.

Repeat targeted tests:

```sh
pnpm --dir packages/hub-page exec vitest run src/__tests__/service-worker-privacy.test.ts src/__tests__/private-navigation-session.test.ts
pnpm --dir packages/hub-page typecheck
```

## Release requirements

Deploy the worker, registration/session cleanup, logout and worker-header changes together. No database migration is required. Verify the deployed `/sw.js` bytes/cache header and controller, then repeat a synthetic A → logout → B/offline check on the deployed origin before closing production rollout.

A device that remains offline with the old worker cannot receive or purge itself through a new release until it reconnects and activates the update. This change does not claim to erase already-downloaded data remotely, protect against a compromised browser, or restore private offline Pass functionality. Other audit findings remain separate.
