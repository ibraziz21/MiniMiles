# Akiba Pass UX & Web Design Audit

**Scope:** `packages/hub-page` (the Akiba Pass consumer web app — Next.js 14 App Router, Tailwind CSS, Supabase auth).
**Framework:** Vercel Web Interface Guidelines (fetched live from `vercel-labs/web-interface-guidelines`) + a manual product-UX pass.
**Method:** Full route/component inventory + four parallel deep-dive reads covering every user-facing file in the app (entry/auth/onboarding; account/profile; merchant/shop/voucher/quest/earn; games + shared component library), each checked line-by-line against the guideline checklist and judged for product UX (purpose clarity, hierarchy, cognitive load, feedback, trust, discoverability, consistency).
**Constraints honored:** read-only audit, no code changes made; branding preserved; findings are graded, not inflated; guideline violations are distinguished from subjective preference throughout.

---

## 1. Executive Summary

**Overall score: 7.0 / 10 — Good, with real and fixable gaps.**

Akiba Pass has a **genuinely strong foundation**: a coherent color/token system (`akiba.teal/ink/muted/paper/card/line/tint`), a well-thought-out navigation model with correct active-route resolution, resilient server-side data-fetching patterns (defensive `Promise.allSettled`/try-catch fallbacks that keep pages rendering when a downstream service fails), and at least two areas of the product — the `/referrals` page and the `RewardsSnapshot`/`NextRewardPanel`/`RewardProgressBar` home-dashboard cluster — that are close to reference-quality, accessible, reduced-motion-aware, fully token-driven implementations. Several trust-critical flows (voucher redemption confirmation, order payment-failure recovery, QR pass presentation) have unusually thoughtful, specific microcopy that most consumer apps get wrong.

Against that foundation sits a **consistent, repeated set of gaps** that mostly trace back to one root cause: **the app has no shared, accessible primitives for forms, modals/sheets, or buttons.** Every form field, every modal/drawer/sheet, and most buttons are hand-rolled per file. That's why the same five defects recur across 15+ files: placeholder-only labels, `outline-none` with no real focus replacement, no `aria-live` on async success/error text, no focus trap/Escape/scroll-lock on overlays, and Miles/price numbers with no `tabular-nums` (confirmed via full-repo grep: **zero** `tabular-nums` usage anywhere in `src/`, and **zero** `prefers-reduced-motion` usage anywhere).

**Strongest areas:** `/referrals`, the home-dashboard rewards cluster (`RewardsSnapshot`, `NextRewardPanel`, `RewardProgressBar`), `/pass`'s in-the-moment microcopy, `/merchants`' URL-synced filtering, and the voucher/order payment-recovery error states.

**Weakest areas:** the games surfaces (`/games/memory-flip`, `/games/rule-tap` — visually disconnected from the brand, and **not actually playable by screen-reader users** despite using real `<button>` tiles), `WalletPickerModal` (zero dialog semantics on a modal that gates the user's own balance), and `CartDrawer` (unlabeled checkout fields, no safe-area handling, and a hardcoded/undisclosed FX rate baked into the real payment total).

**Highest-risk UX problems (see §10 for the full register):**
1. `MemberHome`'s rewards/balance snapshot **silently disappears** with zero error state when its backend fetch fails — the one number a loyalty-app member opens the app to check can vanish with no explanation.
2. `WalletPickerModal` — the modal that gates access to `/me`'s balance/activity for multi-wallet accounts — has no `role="dialog"`, no focus trap, no scroll lock, and no `Escape` handling.
3. Both mini-games' interactive tiles are real `<button>` elements (good), but their `aria-label`s never disclose the tile's actual state (which symbol, which color) — the core mechanic is **unplayable non-visually**.
4. `CartDrawer` bakes a **hardcoded, undisclosed 130 KES/USD conversion rate** directly into the real checkout total, with two slightly different rounding functions computing the "same" number in two places.

**Highest-leverage improvements** (full list in §11): fixing `MilesIcon.tsx`'s `MilesAmount` component (locale + `tabular-nums`) alone touches nearly every Miles number in the app; building one shared accessible Modal/Sheet primitive fixes six independently-broken overlays at once; and the `/merchants` URL-sync pattern already exists and just needs to be copied onto `/shop`, `VoucherTabs`, and `LeaderboardSection`.

---

## 2. Application Architecture & Route Inventory

**Stack:** Next.js 14.2 (App Router), React 18.3, Tailwind CSS 3.4, Supabase (`@supabase/ssr`) for auth, `lucide-react` for icons (hub-page) / `@phosphor-icons/react` for icons (the injected `@akiba/skill-games` workspace package that renders the two mini-games), `qrcode` for Pass QR rendering, no component-primitive library (no Radix, no Headless UI, no `focus-trap-react` in `package.json`).

**Auth gating** (`src/middleware.ts`): `/me`, `/pass`, `/welcome`, `/referrals`, `/games`, `/earn` require a session; unauthenticated requests redirect to `/login?next=<path>`. `/login` itself redirects signed-in users to `/me` (or `next`).

### Route table

| Route | Auth | File | Notes |
|---|---|---|---|
| `/` | Public, dual-render | `src/app/page.tsx` → `VisitorLanding.tsx` / `MemberHome.tsx` | Same URL for both; no redirect, so bookmarks/deep-links never break |
| `/join` | Public | `src/app/(auth)/join/page.tsx`, `JoinQrReveal.tsx` | In-store fast-signup (email OTP), also referral-attributed variant |
| `/login` | Public (redirects if authed) | `src/app/(auth)/login/page.tsx` | OTP or password, preserves `?next=` |
| `/auth/callback` | Route handler | `src/app/auth/callback/route.ts` | OAuth/magic-link code exchange |
| `/r/[code]` | Public route handler | `src/app/r/[code]/route.ts` | Referral landing → sets attribution cookie → redirects to `/join?src=referral` |
| `/merchants` | Public | `src/app/merchants/page.tsx`, `MerchantFilters.tsx` | Directory, server-paginated, URL-synced filters (reference implementation) |
| `/merchants/[slug]` | Public | `src/app/merchants/[slug]/page.tsx`, `ProductGrid.tsx` | Merchant profile: hero, branches, vouchers, embedded shop |
| `/shop` | Public | `src/app/shop/page.tsx`, `ShopFilters.tsx` | A **second**, independently-built "browse merchants" surface |
| `/shop/[slug]` | Public | `src/app/shop/[slug]/page.tsx`, `AddToCart.tsx` | A **second** merchant-catalog page, overlapping `/merchants/[slug]`'s "Shop online" section |
| `/vouchers` | Public | `src/app/vouchers/page.tsx`, `VoucherTabs.tsx` | Available/Active/Used/Expired catalog + "my vouchers" |
| `/vouchers/[id]` | Protected (ownership-checked) | `src/app/vouchers/[id]/page.tsx`, `VoucherDetailView.tsx` | Voucher detail + QR redemption lifecycle |
| `/my-vouchers` | Protected | `src/app/(protected)/my-vouchers/page.tsx` | Permanent redirect → `/vouchers` (legacy link compat) |
| `/quests` | Public/mixed | `src/app/quests/page.tsx`, `QuestsPageClient.tsx`, `HubQuestCard.tsx` | Hub quest catalog; `PartnerQuestCard.tsx` present but currently unmounted (migration pending) |
| `/welcome` | Protected | `src/app/(protected)/welcome/page.tsx`, `WelcomeCarousel.tsx` | 3-slide onboarding carousel ending in live QR reveal; server-gated to show once |
| `/earn` | Protected | `src/app/(protected)/earn/page.tsx`, `EarnCards.tsx` | Hub linking to merchant-earning / quests / games / referrals |
| `/games` | Protected | `src/app/(protected)/games/page.tsx`, `LeaderboardSection.tsx` | Game launcher hub + leaderboard tabs |
| `/games/leaderboard` | Protected | `src/app/(protected)/games/leaderboard/page.tsx` | Legacy-URL redirect → `/games?section=leaderboard` |
| `/games/memory-flip` | Protected | `src/app/(protected)/games/memory-flip/page.tsx` | Mini-game session |
| `/games/rule-tap` | Protected | `src/app/(protected)/games/rule-tap/page.tsx` | Mini-game session (timing-sensitive) |
| `/me` | Protected | `src/app/(protected)/me/page.tsx` | Account dashboard: balance, next reward, quick actions, activity |
| `/me/activity` | Protected | `.../me/activity/page.tsx` | Full activity history (capped at 50, no pagination) |
| `/me/notifications` | Protected | `.../me/notifications/page.tsx` | Push settings + notification history (capped at 50) |
| `/me/orders` | Protected | `.../me/orders/page.tsx` | Order history, dispute, receipt confirmation, payment recovery |
| `/pass` | Protected | `src/app/(protected)/pass/page.tsx` | Full-screen dedicated Pass QR page |
| `/referrals` | Protected | `src/app/(protected)/referrals/page.tsx`, `ReferralsPageClient.tsx` | Referral dashboard — the audit's reference-quality page |

### Major modals / drawers / sheets (not routes, but primary interaction surfaces)

| Surface | File | Notes |
|---|---|---|
| Cart checkout drawer | `src/components/CartDrawer.tsx`, opened from `CartButton.tsx` | Global, in header; cart→delivery→review→pay→done/error |
| Wallet picker (forced) | `src/app/(protected)/me/WalletPickerModal.tsx` | Blocking modal when email resolves to multiple legacy wallets |
| Profile quick-actions sheet | `src/app/(protected)/me/ProfileQuickActions.tsx` | Hosts Pass/Wallets/Security bottom sheets from `/me` |
| Voucher redeem confirm sheet | `src/components/vouchers/GetVoucherButton.tsx` | Quote → confirm → redeem |
| Merchant filters sheet | `src/app/merchants/MerchantFilters.tsx` (`FiltersSheet`) | Category/city/mode filters |
| Push opt-in modal | `src/components/PushOptInPrompt.tsx` | Standalone-PWA-only; the best-implemented overlay in the app |
| Install banner | `src/components/InstallPrompt.tsx` | Add-to-home-screen prompt (Android/desktop native, manual iOS) |

### Confirmed dead code (unreachable, not imported anywhere — verified by grep)

`src/components/AppBanner.tsx`, `WalletPersonalization.tsx`, `Hero.tsx`, `HowItWorks.tsx`, `FooterCTA.tsx`, `PartnerCTA.tsx`, `PartnerStrip.tsx`, `src/app/(protected)/me/BalanceDisplay.tsx`. All reflect a superseded "wallet-connect gated" product model contradicted by the current intent-first `VisitorLanding`. `BalanceDisplay.tsx` is a particular risk: if ever reactivated as-is, it computes a balance a different way than `getUserBalance()` and would show a **second, disagreeing "your balance" number**. Recommend deleting all eight or explicitly re-wiring them — see §12.

---

## 3. Design System Audit

**Design System Maturity Score: 5.5 / 10.**

The token *vocabulary* is good (a small, well-named, consistently-referenced color palette; a sane two-typeface pairing). What's missing is *primitives*: there is no accessible base for forms, modals, or buttons, so every consumer reimplements its own version — and consistency degrades exactly where you'd expect once you don't have a shared base to inherit correctness from.

### Colors

Defined in `tailwind.config.ts:12-22`:

```
akiba.teal  #238D9D   (primary brand / action)
akiba.ink   #0D0E0C   (dark surfaces, primary text)
akiba.muted #504C4C   (secondary text)
akiba.paper #FCFCFC   (page background)
akiba.card  #F7F7F7   (card background)
akiba.line  #E2E2E2   (borders)
akiba.tint  #EAF7F9   (teal-tinted background, e.g. active pills)
```

**No semantic status tokens exist** (success/warning/error/info) — this is the biggest gap. `src/app/(protected)/me/orders/page.tsx:13-59` (`STATUS_CONFIG`) hand-picks raw Tailwind palette colors per status (`bg-blue-50 text-blue-700`, `bg-amber-50`, `bg-purple-50`, `bg-green-50`, `bg-red-50`) — only 1 of 8 statuses (`completed`) uses an `akiba.*` token. Error/danger states elsewhere (`DisputeButton.tsx`, `CartDrawer.tsx` confirm banner) independently reach for raw `red-*`/`amber-*` too, which is a defensible choice for danger semantics but is never centralized as a token, so every file picks its own shade.

**Hardcoded hex values duplicated outside the token set** (all confirmed via direct file reads):
- `#1E7E8D` — a teal-hover-darken shade, copy-pasted verbatim across `join/page.tsx` (×2), `login/page.tsx` (×3), `WelcomeCarousel.tsx` (×1) — 6 occurrences of one un-tokenized value.
- `#0D3349`, `#374151`, `#9CA3AF`, `#059669` — canvas-drawn colors in `AkibaPassCard.tsx`'s exported PNG (`buildPassCard()`), none matching `akiba.ink`/`akiba.teal`. Understandable (canvas can't consume Tailwind classes) but should be named constants tied to the real tokens.
- `#247d91`, `#315a78` — gradient stops in `PushOptInPrompt.tsx:182`.
- `#0D7A8A`, `#1A9AAD`, `#4EFFA0` — gradient/accent-dot in `EarnCards.tsx:12,15`.
- `#0D7A8A`/`#238D9D`/`#1A9AAD` (Rule Tap) and `#3B1F6E`/`#5B35A0`/`#7B4CC0` (Memory Flip) — the two games' full gradient palettes, `games/page.tsx:41,49`; Memory Flip's purple has **no relationship to `akiba.teal`** anywhere.
- `#F7F4FF` / `#F7FEFF` — the two game pages' own hardcoded body backgrounds (`memory-flip/page.tsx:161`, `rule-tap/page.tsx:160`).
- `amber-200/50/800` — `AddToCart.tsx:68`'s cart-conflict confirm banner.

**Recommendation:** add `akiba.status.{info,success,warning,danger}` tokens and migrate `STATUS_CONFIG` + the games' gradients onto real (even if game-specific) tokens rather than one-off hex.

### Typography

- **Display/headings:** `sterling` — a local custom font (`layout.tsx:15-24`, Georgia/serif fallback), applied via `font-sterling`.
- **Body:** DM Sans, loaded via a render-blocking `@import url(...)` in `globals.css:1` — **not** via `next/font/google`. This is a real, fixable performance issue (see §7).
- **A third family is referenced but never loaded:** `font-poppins` is defined in `tailwind.config.ts:27` and used throughout the `@akiba/skill-games` package's UI (`game-header.tsx`, `game-intro-sheet.tsx`, `game-result-sheet.tsx`, `masteryCopy.tsx` — 8+ call sites), but Poppins is never imported anywhere (no `next/font`, no `@import`). **Every game screen is silently falling back to the browser's generic sans-serif** instead of the intended typeface. This is a genuine bug, not a preference — confirm and fix in Phase 1/2.
- **Tabular numerals: zero usage anywhere in `src/`** (confirmed by repo-wide grep). This affects the Miles balance on `/me`, the referral stats row, order/voucher prices, the live-QR countdown timer, and — most acutely — the games' rapidly-changing score/timer/combo numbers. Single highest-leverage typography fix: add `tabular-nums` to `MilesAmount` in `src/components/MilesIcon.tsx:62-65`, since it's the most widely-reused number-rendering primitive in the app.
- **Ellipsis discipline is mostly good** — real `…` characters used correctly almost everywhere truncation/loading text appears. Two exceptions: `ConfirmReceiptAction.tsx:125` renders a **bare** `"…"` as a button's entire loading label (should be `"Enabling…"`), and `PushOptInPrompt.tsx:200` uses literal `"You're Early..."` (three periods).
- No `text-balance`/`text-pretty` usage found; `SectionHeader.tsx:33` renders large (`text-4xl`/`text-5xl`) headings and would directly benefit.
- Currency/number formatting is inconsistent: many files correctly call `.toLocaleString("en-KE", ...)` / `Intl.DateTimeFormat`-equivalent patterns, but several hardcode `` `$${n.toFixed(2)}` ``-style string concatenation instead of `Intl.NumberFormat` (see §7 Locale/i18n).

### Spacing

No documented spacing scale beyond Tailwind's default; in practice, usage is disciplined — the vast majority of files stick to the default scale (`px-4`, `py-2.5`, `gap-2`, etc.) with very few arbitrary bracket values. The few found: `ProfileQuickActions.tsx:88-90` (inline `style={{ gridTemplateColumns }}` for a dynamic column count — reasonable given it's genuinely dynamic), and z-index is **not** a documented scale — observed values are `z-40` (`AppBanner`, header), `z-50` (`BottomNav`, `PassFab`, `WalletPickerModal`), `z-[60]` (`ProfileQuickActions` sheet), `z-[70]` (`PushOptInPrompt`) — four different ad hoc layer values with no defined relationship. Recommend a documented `z-*` scale (e.g. `z-nav`, `z-overlay`, `z-modal`, `z-toast`).

### Radius

`rounded-xl` (inputs/buttons/small cards), `rounded-2xl` (standard cards), `rounded-3xl` (sheets/big feature cards) — reasonably coherent three-step scale, applied consistently in most files. Minor mixing observed on `/me` (balance card `rounded-2xl`/`rounded-3xl` mixed within the same page).

### Shadows / elevation

`shadow-soft` and `shadow-chip` are defined in `tailwind.config.ts:29-32` and used with real intent (chip = small floating elements like the Pass QR card; soft = larger surfaces). A few components (`games/page.tsx:133`) fall back to raw Tailwind `shadow-sm` instead of the two defined tokens — minor, low-priority drift.

### Buttons

**No single button primitive is actually load-bearing.** `ButtonLink.tsx` exists (`primary`/`secondary`/`ghost` variants, internal/external `href` auto-detection) and is fully token-driven with a good `min-h-11` touch target — but it (a) has **no `focus-visible` ring styling at all** despite being the one component meant to standardize that, (b) forces an unconditional trailing arrow icon with no way to hide it, and (c) has no `loading`/`disabled` state. As a direct consequence, most of the app **hand-rolls its own buttons** instead of using it: `games/page.tsx:182-187`, `LocationOptIn.tsx:83-90`, `ReferralCard.tsx:37-44/56-63`, `RewardsSnapshot.tsx:191-206`, and more all independently reimplement `rounded-full bg-akiba-teal px-4 py-2 text-white ...`. Separately, the injected `@akiba/skill-games` workspace ships its **own**, more capable `Button` (`packages/skill-games/src/components/ui/button.tsx`, `cva`-based, supports `loading`/`disabled`/`asChild`) that shares nothing with `ButtonLink`. Two independent button systems exist in one monorepo.

### Inputs / forms

**No shared `Input`/`Label`/`Select` primitive exists.** Every form field across `join/page.tsx`, `login/page.tsx`, `SetPasswordForm.tsx`, `CountryEditor.tsx`, `UsernameEditor.tsx`, `DisputeButton.tsx`, `RecoveryBanner.tsx`, `CartDrawer.tsx` (6+ fields), `HomeIntentSearch.tsx`, `MerchantFilters.tsx`, `ShopFilters.tsx` is a hand-written `<input className="rounded-xl border border-akiba-line ...">`. This single gap is the direct cause of two systemic, repeated defect classes documented in §5: (1) inconsistent focus-ring treatment — some inputs correctly use `focus-visible:ring-2 focus-visible:ring-akiba-teal` (`MerchantFilters.tsx:205`, `HomeIntentSearch.tsx:71`), most use only `outline-none focus:border-akiba-teal` with no ring at all (`ShopFilters.tsx:60`, `UsernameEditor.tsx:78`, all 6 `CartDrawer.tsx` fields, `CountryEditor.tsx:43`); (2) placeholder-only labeling with no real `<label>`/`aria-label` on 8+ distinct fields.

### Cards

At least **four independently-built "merchant card" implementations** exist for conceptually the same thing: `MerchantValueCard.tsx` (used on home rails + `/merchants` — the gold-standard implementation: correct `alt`/`aria-hidden` split, `truncate`, `focus-visible` ring, real `MilesAmount`), `ShopFilters.tsx`'s inline `MerchantCard` (no focus ring, raw `<img>`, no `aria-pressed` on its filter chips), `VoucherCard.tsx` (merchant-profile vouchers), and `CampaignCard.tsx` (marketing). Voucher "cost in Miles" specifically renders two different ways depending on which card you're looking at: the correct icon+`MilesAmount` pairing in `MerchantValueCard`/`GetVoucherButton`/`HubQuestCard`, versus bare stacked numeral text with no icon at all in `VoucherCard.tsx:41-44`, `VoucherTabs.tsx`'s `AvailableCard`, and `shop/[slug]/page.tsx`'s `VoucherTemplateRow:300-303`. This also breaks the project's own established brand convention (Miles must display as `[symbol]amount`, never bare text) in exactly the place — redemption cost — where getting it right matters most.

### Navigation

`SiteHeader.tsx` (desktop) + `NavLinks.tsx` (`BottomNav`, `PassFab`) share one well-designed active-route resolver, `resolveActivePrimary()` (`NavLinks.tsx:24-36`), which deliberately avoids false-positive prefix matches (e.g. `/me` never falls out of `/merchants`, `/pass` intentionally marks no primary tab active since it's a one-tap action, not a destination) — genuinely good IA engineering, documented inline with references to the nav spec. **However, every navigation link in both `SiteHeader.tsx` and `NavLinks.tsx` — the sign-in pill, the account pill, all five primary tabs, the Pass pill, all five bottom-nav items, and the floating `PassFab` — uses a raw `<a href>` instead of `next/link`'s `<Link>`.** Since these are the single highest-frequency interaction in the whole app (every screen change goes through one of them), this means **every in-app navigation triggers a full page reload** instead of a client-side transition — a real, systemic perceived-performance cost, not a one-off. `PassFab` additionally has no `aria-label` (icon-only, `NavLinks.tsx:144-156`).

### Icons

`lucide-react` is used consistently throughout `hub-page` — good, single-library discipline. The injected `@akiba/skill-games` package (which renders both mini-games' UI) uses a **second, unrelated icon library**, `@phosphor-icons/react`, with different stroke weights — visibly different icon rendering directly between the `games/page.tsx` launcher card (`lucide-react`'s `Gamepad2`/`Zap`/`Brain`) and the actual gameplay screen it links to. `LinkedWallets.tsx:95,145` uses raw emoji (📱🔵) instead of `lucide-react` icons for wallet-type indicators — inconsistent visual weight and not confirmed to be `aria-hidden`.

### Feedback components

**No shared Toast/Alert/Banner/Modal/Sheet primitive exists anywhere in the app.** Error text is `<p>{error}</p>` hand-rolled per file, and only **2 of the ~15 places that need it** correctly wrap it in `aria-live="polite"` (`ReferralsPageClient.tsx:132-135`'s copy-confirmation, `LocationOptIn.tsx:62`'s denied-state message). At least **six independent modal/sheet/drawer implementations** exist (`CartDrawer`, `WalletPickerModal`, `ProfileQuickActions` sheet, `GetVoucherButton` confirm sheet, `MerchantFilters` `FiltersSheet`, `PushOptInPrompt`), each with a different subset of correct behavior — `PushOptInPrompt` is the best (`role="dialog" aria-modal="true"`, scroll lock, Escape-to-close, but still no focus trap), `WalletPickerModal` is the worst (none of the above). No loading skeleton primitive exists either — `animate-pulse` is used ad hoc in the (dead-code) `BalanceDisplay.tsx`, and `MerchantFilters.tsx`'s `SkeletonGrid()` fully replaces visible results on every filter change rather than a subtler in-place treatment.

---

## 4. Page-by-Page Audit

Scores are 0–10 per the rubric in the brief (9–10 Excellent, 7–8.9 Good, 5–6.9 Needs Improvement, 3–4.9 Poor, 0–2.9 Critical). Not inflated — see reasoning under each page.

### `/` — Visitor Landing (signed-out)

**Purpose:** Intent-first merchant discovery, no sign-up wall on browsing.

| Category | Score |
|---|---|
| Visual design | 8.0 |
| Information hierarchy | 8.5 |
| Usability | 8.0 |
| Mobile UX | 8.0 |
| Accessibility | 7.0 |
| Interaction feedback | 5.0 |
| Design-system consistency | 8.5 |
| Performance | 7.0 |
| **Overall** | **7.5 — Good** |

**What works:** `<h1>` + immediate search bar makes intent obvious in under 2 seconds; no competing CTAs; clean section order (search → shortcuts → rail → location opt-in → rail); honest "no sign-up wall to browse" model matches the code.

**Problems:** No `src/app/loading.tsx` or `error.tsx` anywhere in the app (confirmed) — `VisitorLanding.tsx:13-17` `await`s the whole feed before returning anything, so a slow backend means a blank tab with zero skeleton, and an unhandled `getHomeFeed` failure (it lacks the `.catch` that `listDirectoryCities` has) falls through to Next's default unstyled error page.

**Recommended improvements:** Add a route-level `loading.tsx` skeleton matching the search+rail layout; add `error.tsx`; wrap `getHomeFeed` in the same defensive `.catch` pattern already used for `listDirectoryCities`.

**Relevant files:** `src/app/VisitorLanding.tsx`, `src/app/page.tsx`, `src/lib/home/feed.ts`.

---

### `/` — Member Home (signed-in)

**Purpose:** Same intent-first shell, personalized greeting + rewards snapshot.

| Category | Score |
|---|---|
| Visual design | 8.0 |
| Information hierarchy | 8.0 |
| Usability | 6.5 |
| Mobile UX | 8.0 |
| Accessibility | 7.0 |
| Interaction feedback | 4.0 |
| Design-system consistency | 8.5 |
| Performance | 7.0 |
| **Overall** | **6.8 — Needs Improvement** |

**What works:** Search stays primary even for members (deliberate, documented decision); conditional referral card avoids clutter; strong `RewardsSnapshot` component underneath (see §3, §12) when it renders successfully.

**Problems (this page's score is dragged down by one severe issue):** `MemberHome.tsx:57-64` — `feed.rewards` is `null` whenever the balance fetch rejects (caught via `Promise.allSettled` in `feed.ts:235-253`, only `console.error`'d), and `RewardsSnapshot` simply isn't rendered when `rewards` is null — **the entire Miles-balance section silently vanishes** with no error message, no retry, nothing distinguishing "you have zero rewards" from "we failed to load them." This is the single highest-risk finding in the whole audit for a loyalty app. Secondary: `MemberHome.tsx:30`'s `firstName = displayName.split(" ")[0]` can render the user's **entire raw email address** as their greeting name when no display name/username exists (an email has no space to split on).

**Recommended improvements:** Pass through an explicit `{ rewards: { error: true } }` shape on fetch failure so the UI can render "Couldn't load your balance — tap to retry" instead of nothing; give `resolveHubProfile` (`src/lib/akiba/hubProfile.ts:81`) a friendlier fallback than the raw email string.

**Relevant files:** `src/app/MemberHome.tsx`, `src/lib/home/feed.ts:235-253`, `src/lib/akiba/hubProfile.ts:81`, `src/components/home/RewardsSnapshot.tsx`.

---

### `/join`

**Purpose:** Counter-time-optimized in-store signup (email OTP, single screen, no scroll).

| Category | Score |
|---|---|
| Visual design | 8.0 |
| Information hierarchy | 8.0 |
| Usability | 6.0 |
| Mobile UX | 6.5 |
| Accessibility | 5.0 |
| Interaction feedback | 5.5 |
| Design-system consistency | 8.0 |
| Performance | 8.0 |
| **Overall** | **6.5 — Needs Improvement** |

**What works:** Genuinely excellent single-purpose layout for its stated goal ("sign up in 1 minute"); loading-state button text ("Sending…"/"Verifying…") is correct and clear; `safeNextPath()` correctly guards against open-redirect.

**Problems:** No `<form>` element anywhere (`page.tsx:93-172`) — pressing Enter does nothing, and mobile keyboards' "Go" action key won't submit either, directly undermining the "counter-time" pitch. Neither the email nor OTP `<label>` has `htmlFor` (`115`, `130`) — not clickable, not screen-reader-associated. Error message has no `aria-live` (`148-150`). OTP field lacks `autoComplete="one-time-code"` (`133-141`), so the iOS/Android SMS/email autofill quick-fill never appears — a real friction cost in exactly the speed-optimized moment this flow exists for. No way to correct a mistyped email once past the first step (input is `disabled`, no "change email" link, unlike `/login`). No trust/data-use copy at all (contrast with `/login`'s reassurance line).

**Recommended improvements:** Wrap in `<form onSubmit>`; add `id`/`htmlFor` pairs; wrap error in `<p role="alert">` (mirror `PushOptInPrompt.tsx:235`'s correct pattern); add `autoComplete="one-time-code"` to the OTP field and `autoComplete="email" spellCheck={false}` to the email field; add a "Change email" link matching `login/page.tsx:152-157`.

**Relevant files:** `src/app/(auth)/join/page.tsx`, `JoinQrReveal.tsx`.

---

### `/login`

| Category | Score |
|---|---|
| Visual design | 8.0 |
| Information hierarchy | 7.5 |
| Usability | 6.0 |
| Mobile UX | 6.5 |
| Accessibility | 5.0 |
| Interaction feedback | 5.5 |
| Design-system consistency | 8.0 |
| Performance | 8.0 |
| **Overall** | **6.4 — Needs Improvement** |

**What works:** Best trust copy in the auth surfaces ("we'll create your account automatically" demystifies new-vs-returning in one line); "Change email" reset correctly preserves the typed email while clearing only OTP state — a genuinely good micro-UX touch.

**Problems:** Same missing-`<form>`/no-Enter-submit and unlabeled-fields issues as `/join` (`78-222`, `121-168`). The OTP/Password mode toggle (`95-116`) is two plain buttons distinguished only by background color, with **no `aria-pressed`/`role="tab"`** — a screen-reader user tabbing onto them hears "Email code, button" with zero indication which mode is active. No password-visibility toggle. Most consequential: `src/app/auth/callback/route.ts:28` redirects failed sign-ins to `/login?...&error=auth_failed`, but `login/page.tsx` **never reads that `error` param** — a user whose magic-link/OAuth callback failed is silently dropped onto a blank form with zero explanation.

**Recommended improvements:** Same form/label/aria-live fixes as `/join`; add `aria-pressed` to the mode toggle; read `searchParams.get("error")` and surface "That sign-in link expired or was already used" copy.

**Relevant files:** `src/app/(auth)/login/page.tsx`, `src/app/auth/callback/route.ts`.

---

### `/welcome`

| Category | Score |
|---|---|
| Visual design | 8.5 |
| Information hierarchy | 8.5 |
| Usability | 8.0 |
| Mobile UX | 8.0 |
| Accessibility | 6.5 |
| Interaction feedback | 7.0 |
| Design-system consistency | 8.0 |
| Performance | 7.5 |
| **Overall** | **7.7 — Good** |

**What works:** Three tightly-scoped slides, each pairing one concrete benefit with one icon; "Scan. Earn. Repeat." numbered-step slide is genuinely well-written; skip is always available and appropriately de-emphasized; server-side gating (`welcome/page.tsx:29-40`) correctly guarantees this never shows without a real pass, and never shows twice.

**Problems:** Progress dots (`WelcomeCarousel.tsx:139-146`) convey "slide 2 of 4" only via color, with no `aria-current`/group label. Decorative `QrCode`/`Store`/`Repeat` icons lack `aria-hidden="true"`. The final (most important) slide shows a blank QR square while the first live token resolves, with no loading state — a "did this break?" moment at the flow's payoff.

**Recommended improvements:** Add `aria-current="true"` to the active dot or wrap in a labeled group; add `aria-hidden="true"` to decorative icons; add a skeleton/spinner in the QR canvas container until the first token resolves.

**Relevant files:** `src/app/(protected)/welcome/page.tsx`, `WelcomeCarousel.tsx`.

---

### `/me` (dashboard)

| Category | Score |
|---|---|
| Visual design | 8.0 |
| Information hierarchy | 7.5 |
| Usability | 6.5 |
| Mobile UX | 6.0 |
| Accessibility | 6.0 |
| Interaction feedback | 6.5 |
| Design-system consistency | 7.5 |
| Performance | 7.5 |
| **Overall** | **6.8 — Needs Improvement** |

**What works:** The Miles balance is a strong, unambiguous visual anchor (large `font-sterling` numerals on a full-bleed dark card, first thing below the header); the "no-wallet-found" edge case (`229-236`) correctly explains why and what to do — a genuinely good error message.

**Problems:** `CountryEditor` and interest chips are wrapped in `hidden ... sm:flex` (`page.tsx:216-226`) — **completely unreachable on mobile**, on the exact device class this is a mobile-first PWA for, removing a functional profile control (and a quest verifier field) from most real users. No `<h1>` on the page. Balance figures have no `tabular-nums` (`145-172`). The current-vs-pending Miles distinction only appears in one specific state combination (`ledgerBalance > 0 && walletAddress`) — a user with only ledger Miles and no wallet sees one number with no settlement-status indication at all, on the app's single most trust-critical number.

**Recommended improvements:** Move `CountryEditor`/interest chips into a reachable mobile location (e.g. the Security sheet, or its own settings row); add a page `<h1>`; add `tabular-nums`; make the pending/settled distinction unconditional.

**Relevant files:** `src/app/(protected)/me/page.tsx`, `CountryEditor.tsx`, `BalanceDisplay.tsx` (dead code, do not resurrect as-is).

---

### `/me/activity`

| Category | Score |
|---|---|
| Visual design | 8.0 |
| Information hierarchy | 8.0 |
| Usability | 7.0 |
| Mobile UX | 7.5 |
| Accessibility | 7.0 |
| Interaction feedback | 7.0 |
| Design-system consistency | 8.5 |
| Performance | 6.5 |
| **Overall** | **7.4 — Good** |

**What works:** Clean, scannable reverse-chronological list; Miles delta is appropriately the second-most-prominent element; consistent empty-state pattern (icon+title+hint+CTA).

**Problems:** Hard `limit: 50` with **no pagination and no "showing your last 50" disclosure** — a heavy user's older activity is silently unreachable. `relativeTime()` (`ActivityFeed.tsx:26-36`) hand-rolls "2h ago"-style strings instead of `Intl.RelativeTimeFormat` — the checklist's explicit hardcoded-date-format anti-pattern. No filter by activity kind, no URL state.

**Recommended improvements:** Add cursor-based "load more" (reflected in the URL); replace `relativeTime()` with `Intl.RelativeTimeFormat("en-KE", { numeric: "auto" })`.

**Relevant files:** `src/app/(protected)/me/activity/page.tsx`, `ActivityFeed.tsx`.

---

### `/me/orders`

| Category | Score |
|---|---|
| Visual design | 7.0 |
| Information hierarchy | 7.5 |
| Usability | 6.5 |
| Mobile UX | 7.0 |
| Accessibility | 6.5 |
| Interaction feedback | 6.0 |
| Design-system consistency | 6.0 |
| Performance | 6.5 |
| **Overall** | **6.6 — Needs Improvement** |

**What works:** `OrderTimeline`'s native `<details>/<summary>` progressive disclosure is a clean, keyboard-accessible pattern; the payment-failure vs. payment-succeeded-order-failed distinction in `RecoveryBanner`/`CartDrawer`'s error step is sophisticated, trust-preserving engineering.

**Problems:** `STATUS_CONFIG` (`13-59`) is the clearest single design-token deviation in the app — 7 of 8 status colors are raw Tailwind palette, not `akiba.*` tokens. `RewardBadge` (`298-304`) renders `+{reward.miles} AkibaMiles` as **literal text**, breaking the established brand convention (Miles must render as `[symbol]amount`) that the rest of this same file gets right via `MilesAmount` elsewhere. Currency is hardcoded string concatenation (`` `${amount.toFixed(2)} ${currency}` ``, `211`) instead of `Intl.NumberFormat`. Dispute flow (`DisputeButton.tsx`) never tells the user what happens after they submit a report — no expected timeline, no confirmation of next steps, in a flow where real money is at stake.

**Recommended improvements:** Define `akiba.status.*` tokens and migrate `STATUS_CONFIG`; replace `RewardBadge`'s literal text with `<MilesAmount amount={reward.miles} prefix="+" />`; use `Intl.NumberFormat` for the payment amount; add "we'll review within X" copy to the dispute confirmation.

**Relevant files:** `src/app/(protected)/me/orders/page.tsx`, `DisputeButton.tsx`, `RecoveryBanner.tsx`, `ConfirmReceiptAction.tsx`.

---

### `/me/notifications`

| Category | Score |
|---|---|
| Visual design | 7.5 |
| Information hierarchy | 7.5 |
| Usability | 7.5 |
| Mobile UX | 7.5 |
| Accessibility | 7.0 |
| Interaction feedback | 7.0 |
| Design-system consistency | 8.0 |
| Performance | 7.0 |
| **Overall** | **7.4 — Good** |

**What works:** Defensive type-checking of notification metadata before rendering (`107-114`) prevents malformed data from breaking the page — good resilience pattern; miles-earned notifications get appropriately elevated visual treatment.

**Problems:** Same hard 50-item cap/no-pagination gap as `/me/activity`; empty-state copy only mentions "order updates," underselling the full breadth of what actually appears (referrals, rewards, announcements); `PushNotificationSettings.tsx:95-106` updates a preference toggle optimistically before the PATCH resolves, with **no error handling or rollback** — a failed save leaves the toggle visually "on" while the server never persisted it.

**Recommended improvements:** Broaden empty-state copy; add pagination; wrap the preference-toggle PATCH in try/catch with a revert-on-failure.

**Relevant files:** `src/app/(protected)/me/notifications/page.tsx`, `MilesEarnedLink.tsx`, `src/components/PushNotificationSettings.tsx`.

---

### `/pass`

| Category | Score |
|---|---|
| Visual design | 8.5 |
| Information hierarchy | 8.5 |
| Usability | 8.0 |
| Mobile UX | 8.5 |
| Accessibility | 6.0 |
| Interaction feedback | 6.5 |
| Design-system consistency | 8.5 |
| Performance | 7.5 |
| **Overall** | **7.7 — Good** |

**What works:** The best microcopy in the entire app — "Turn up your screen brightness — this is what the cashier scans" tells the user exactly what to do at the exact moment it matters; the live/offline status indicator is a smart trust signal most loyalty apps skip; "This QR cannot access your account" directly pre-empts a real security worry.

**Problems:** All inherited from `AkibaPassCard.tsx` (see below) — the regenerate button loses its accessible name entirely while regenerating, the regen-warning/error text has no `aria-live`, and the QR `<canvas>` has no accessible name/role of its own.

**Recommended improvements:** See `AkibaPassCard.tsx` fixes below — this page's score rises directly with that component's.

**Relevant files:** `src/app/(protected)/pass/page.tsx`, `src/app/(protected)/me/AkibaPassCard.tsx`.

---

### `AkibaPassCard.tsx` component (used on `/me`, `/pass`, and compact on home)

**Findings:** `256-264` — while regenerating, the button's visible text becomes `""`, leaving only an unreliable `title` attribute as the accessible name; add a persistent `sr-only` label or `aria-label="Issue new QR code"` + `aria-busy`. `233-240` — the regen warning and action-error text have no `aria-live`. `190-192` — the QR `<canvas>` has no `role="img" aria-label`.

---

### `/referrals`

| Category | Score |
|---|---|
| Visual design | 9.0 |
| Information hierarchy | 9.0 |
| Usability | 8.5 |
| Mobile UX | 8.5 |
| Accessibility | 8.5 |
| Interaction feedback | 8.5 |
| Design-system consistency | 9.0 |
| Performance | 8.0 |
| **Overall** | **8.6 — Good (the strongest page in the app)** |

**What works:** This is the audit's reference implementation. Correct `focus-visible:` (not bare `:focus`) rings throughout every share button; the **only** file in the entire app that correctly implements `aria-live="polite"` for an async confirmation (copy-link success); zero hardcoded hex, full `akiba.*` token compliance; correctly uses `Intl`-backed date formatting throughout; genuinely thorough, honest terms disclosure (explicit expiry rules, explicit cap disclosure, explicit "we never share your friends' contact details" statement) — exactly the kind of specific trust copy the rest of the app should match.

**Problems:** Stats-row numbers (friends joined/activated) lack `tabular-nums`, same as elsewhere; no pagination/virtualization for a very long referral list (latent, not yet observed as a real problem).

**Recommended improvements:** Add `tabular-nums` to the stats row; treat this file as the internal template when fixing focus-states and `aria-live` elsewhere.

**Relevant files:** `src/app/(protected)/referrals/page.tsx`, `ReferralsPageClient.tsx`.

---

### `/merchants`

| Category | Score |
|---|---|
| Visual design | 8.0 |
| Information hierarchy | 8.0 |
| Usability | 8.0 |
| Mobile UX | 7.5 |
| Accessibility | 7.0 |
| Interaction feedback | 7.0 |
| Design-system consistency | 8.0 |
| Performance | 7.5 |
| **Overall** | **7.6 — Good** |

**What works:** `MerchantFilters.tsx` is the **only** filter UI in the app that correctly syncs to the URL (`router.replace`, `78-101`) — back/refresh/shared links all preserve filter state, exactly per the guideline; debounced fetch-on-filter-change and debounced analytics; server-paginated with a real "load more"; explicit `aria-label`s on search/clear/near-me controls; distinguishes "no merchants onboarded" from "no results after filtering."

**Problems:** `FiltersSheet` (`353-426`) has no focus trap/Escape/scroll-lock/`role="dialog"`. `SkeletonGrid()` fully replaces visible results on every filter change (jarring flash) rather than an in-place treatment.

**Recommended improvements:** Bring `FiltersSheet` onto the shared modal primitive recommended in §12; soften the skeleton transition.

**Relevant files:** `src/app/merchants/page.tsx`, `MerchantFilters.tsx`.

---

### `/merchants/[slug]`

| Category | Score |
|---|---|
| Visual design | 8.0 |
| Information hierarchy | 8.5 |
| Usability | 8.0 |
| Mobile UX | 7.5 |
| Accessibility | 7.5 |
| Interaction feedback | 7.0 |
| Design-system consistency | 7.5 |
| Performance | 7.0 |
| **Overall** | **7.6 — Good** |

**What works:** Clean heading hierarchy (h1 merchant name → h2 sections → h3/h4 products); all directions/call/WhatsApp/social links are real `<a>`s with `target="_blank" rel="noopener noreferrer"`; icon-only social links correctly carry `aria-label`; ownership is server-checked before rendering vouchers/products; `LocalBusinessJsonLd` only serializes already-public fields.

**Problems:** Raw `<img>` with no dimensions for banner/logo; this page's "Shop online" section duplicates the separate `/shop/[slug]` route for the same merchant (see IA §8).

**Recommended improvements:** Migrate to `next/image`; resolve the `/shop/[slug]` duplication.

**Relevant files:** `src/app/merchants/[slug]/page.tsx`, `ProductGrid.tsx`, `src/components/merchants/*`.

---

### `/shop`

| Category | Score |
|---|---|
| Visual design | 7.0 |
| Information hierarchy | 7.0 |
| Usability | 6.5 |
| Mobile UX | 6.5 |
| Accessibility | 6.5 |
| Interaction feedback | 6.0 |
| Design-system consistency | 5.5 |
| Performance | 6.0 |
| **Overall** | **6.4 — Needs Improvement** |

**What works:** A clear "How it works" 3-step strip right at entry gives good at-a-glance understanding of the earn mechanic.

**Problems:** This is a structural, not cosmetic, problem: `/shop` fetches **all** store-active merchants unbounded (`shop/page.tsx:22-57`) with all filtering done client-side, unlike `/merchants`' server-paginated, URL-synced approach for what is conceptually the same "browse merchants" task. No URL sync at all in `ShopFilters.tsx`. Different ISR staleness contract (`revalidate = 60`) than `/merchants`' `force-dynamic`. No custom error fallback UI, unlike `/merchants`.

**Recommended improvements:** This is the single clearest case in the app for "delete/merge, don't polish" — see §8 IA audit and §11.

**Relevant files:** `src/app/shop/page.tsx`, `ShopFilters.tsx`.

---

### `/shop/[slug]`

| Category | Score |
|---|---|
| Visual design | 7.0 |
| Information hierarchy | 7.0 |
| Usability | 6.5 |
| Mobile UX | 6.5 |
| Accessibility | 6.5 |
| Interaction feedback | 6.5 |
| Design-system consistency | 5.5 |
| Performance | 6.5 |
| **Overall** | **6.5 — Needs Improvement** |

**Problems:** Same hardcoded `$` price formatting and bare-text (not `MilesAmount`) voucher-cost display as elsewhere; duplicates `/merchants/[slug]`'s embedded shop section as a second, differently-laid-out route for the same underlying catalog.

**Relevant files:** `src/app/shop/[slug]/page.tsx`, `AddToCart.tsx`.

---

### `/vouchers`

| Category | Score |
|---|---|
| Visual design | 7.5 |
| Information hierarchy | 7.5 |
| Usability | 7.0 |
| Mobile UX | 7.0 |
| Accessibility | 6.0 |
| Interaction feedback | 6.5 |
| Design-system consistency | 6.5 |
| Performance | 7.0 |
| **Overall** | **6.9 — Needs Improvement (borderline Good)** |

**What works:** Compact mobile "how it works" pill row is a good, low-friction education pattern placed right above the action.

**Problems:** `VoucherTabs.tsx`'s Available/Active/Used/Expired tabs have **no `role="tab"`/`aria-selected`** (`107-122`) — a direct, structural contrast with `QuestsPageClient.tsx`'s visually-identical tab pattern, which gets this right. Tab selection is not URL-synced — a shared link to "my vouchers → Active" always resets to "Available." No search/filter for a growing catalog.

**Recommended improvements:** Copy `QuestsPageClient.tsx`'s `role="tablist"` implementation onto `VoucherTabs`; sync the active tab to `?tab=`.

**Relevant files:** `src/app/vouchers/page.tsx`, `VoucherTabs.tsx`.

---

### `/vouchers/[id]`

| Category | Score |
|---|---|
| Visual design | 7.5 |
| Information hierarchy | 8.0 |
| Usability | 7.5 |
| Mobile UX | 7.5 |
| Accessibility | 6.5 |
| Interaction feedback | 8.0 |
| Design-system consistency | 7.0 |
| Performance | 7.0 |
| **Overall** | **7.4 — Good** |

**What works:** Exemplary pending-purchase reconciliation — distinct, specific copy for different failure classes ("Support has been notified," "Support is clearing it so you can try again") instead of one indefinite spinner; token revoke-on-unmount via `keepalive: true` prevents orphaned live QR tokens; status badges always pair color with text.

**Problems:** The QR countdown timer has no `tabular-nums` (digits jitter as `"9s"` becomes `"10s"`); hardcoded `$` concatenation and locale-less date formatting.

**Recommended improvements:** Add `tabular-nums` to the countdown; `Intl.NumberFormat`/`Intl.DateTimeFormat` throughout.

**Relevant files:** `src/app/vouchers/[id]/page.tsx`, `VoucherDetailView.tsx`.

---

### `/quests`

| Category | Score |
|---|---|
| Visual design | 8.0 |
| Information hierarchy | 8.0 |
| Usability | 8.0 |
| Mobile UX | 7.5 |
| Accessibility | 7.5 |
| Interaction feedback | 8.0 |
| Design-system consistency | 7.5 |
| Performance | 7.5 |
| **Overall** | **7.7 — Good** |

**What works:** Correct `role="tablist"`/`role="tab"`/`aria-selected` implementation (the pattern `VoucherTabs` should copy); an 8-state CTA switch (signed-out/wallet-required/verifying/claiming/eligible/completed/reward-pending/reward-failed/service-unavailable) that never relies on color alone; visibility-aware, capped-backoff polling for "verifying" quests — solid, resource-conscious engineering; specific, quantified CTA labels ("Claim [icon]120 Miles," not "Claim").

**Problems:** Shares an identical `<title>` metadata string ("Earn Miles — Akiba Pass") with `/earn`, despite `/earn` linking into `/quests` as a sub-item — confusing for tabs/bookmarks given the parent-child relationship. No `aria-live` around the "Available Miles" balance after a claim.

**Relevant files:** `src/app/quests/page.tsx`, `QuestsPageClient.tsx`, `HubQuestCard.tsx`.

---

### `/earn`

| Category | Score |
|---|---|
| Visual design | 7.5 |
| Information hierarchy | 8.0 |
| Usability | 8.0 |
| Mobile UX | 7.5 |
| Accessibility | 7.5 |
| Interaction feedback | 7.5 |
| Design-system consistency | 7.5 |
| Performance | 8.0 |
| **Overall** | **7.7 — Good** |

**What works:** Every secondary summary (active-quest count, remaining game plays, pending referral Miles) is independently try/caught and degrades to static copy on failure — the page never breaks even when a downstream service is down, a genuinely strong resilience pattern; the merchant-earning card is correctly the most visually prominent, matching the documented "primary way to earn" product intent.

**Problems:** Duplicate `<title>` with `/quests` (see above); one hardcoded hex gradient (`EarnCards.tsx:12,15`).

**Relevant files:** `src/app/(protected)/earn/page.tsx`, `EarnCards.tsx`.

---

### `/games`

| Category | Score |
|---|---|
| Visual design | 6.5 |
| Information hierarchy | 7.5 |
| Usability | 7.0 |
| Mobile UX | 7.0 |
| Accessibility | 6.5 |
| Interaction feedback | 7.0 |
| Design-system consistency | 5.0 |
| Performance | 7.0 |
| **Overall** | **6.6 — Needs Improvement** |

**What works:** Reward tiers and the daily-play cap are clearly stated up front, sourced from a single `gameRewardRules.ts` config rather than duplicated hardcoded numbers per-surface — good engineering discipline behind the copy.

**Problems:** Hardcoded per-game gradient hex disconnected from `akiba.teal` (worse for Memory Flip's purple, see §3); the Play link has no `focus-visible` ring over its saturated gradient background; discoverability from home is weak and arguably mislabeled — the only path found into `/games` is the **Miles balance tile** on `RewardsSnapshot`, which reads as "see your balance history," not "play a game."

**Recommended improvements:** Bring the launcher palette onto real `akiba.*` tokens; add a `focus-visible:ring-2 focus-visible:ring-white`; reconsider what `RewardsSnapshot`'s balance tile links to.

**Relevant files:** `src/app/(protected)/games/page.tsx`, `LeaderboardSection.tsx`.

---

### `/games/memory-flip`

| Category | Score |
|---|---|
| Visual design | 6.0 |
| Information hierarchy | 7.0 |
| Usability | 6.5 |
| Mobile UX | 6.5 |
| Accessibility | 4.0 |
| Interaction feedback | 6.0 |
| Design-system consistency | 4.5 |
| Performance | 6.5 |
| **Overall** | **5.9 — Needs Improvement** |

**What works:** The game's tiles are real `<button type="button">` elements with `disabled` wired correctly (`packages/skill-games/src/components/memory-flip/memory-card.tsx:31-41`) — **not** the `div onClick` anti-pattern the brief specifically flagged as likely; the pre-play intro sheet clearly states cost/reward before every round.

**Problems (the accessibility score here is the most consequential in the whole audit):** the tile's `aria-label` is a static `"Revealed card"`/`"Hidden card"` that **never discloses which symbol is showing** — every revealed card announces identically to a screen reader, making the entire matching mechanic unplayable non-visually despite correct button semantics. No `prefers-reduced-motion` guard anywhere on the 3D flip transition (confirmed: zero reduced-motion handling anywhere in the `skill-games` package). `sessionId` is held only in React state with no recovery — `recoverSession()` exists in `clientTransport.ts:136` but is **never called anywhere in the codebase**; a refresh or backgrounding mid-round silently strands the session. Visual palette (purple, `#3B1F6E`→`#7B4CC0`) and page background (`#F7F4FF`) have no relationship to the rest of the app's branding. `font-poppins` is used throughout the game's own UI package but never loaded (see §3).

**Recommended improvements:** Change the `aria-label` to include the actual symbol (`` `Revealed card: ${value}` ``); add a `motion-reduce:transition-none` (or equivalent) guard to the flip animation; wire up `recoverSession()` on mount; bring the palette onto `akiba.*` tokens or a documented game-specific token subset; fix the Poppins loading gap.

**Relevant files:** `src/app/(protected)/games/memory-flip/page.tsx`, `packages/skill-games/src/components/memory-flip/memory-card.tsx`, `src/lib/games/clientTransport.ts`.

---

### `/games/rule-tap`

| Category | Score |
|---|---|
| Visual design | 6.5 |
| Information hierarchy | 7.0 |
| Usability | 6.0 |
| Mobile UX | 6.0 |
| Accessibility | 4.0 |
| Interaction feedback | 6.0 |
| Design-system consistency | 4.5 |
| Performance | 6.0 |
| **Overall** | **5.7 — Needs Improvement (weakest scored page in the app)** |

**What works:** Same real-`<button>`-tiles positive as Memory Flip (`rule-tap-board.tsx:32-50`); palette is at least closer to brand teal than its sibling game.

**Problems:** Same screen-reader-unplayable `aria-label` issue (`"Tile N"` never conveys the color/shape the entire rule is based on); same missing session-recovery; `transition-all duration-100` (`rule-tap-board.tsx:38`) is the checklist's named anti-pattern verbatim; score/combo/timer numbers lack `tabular-nums` despite updating multiple times per second; the floating score-delta uses `animate-bounce` with no reduced-motion guard; no `touch-action: manipulation` on tiles, a real fairness risk specifically because this is a tap-timing game where a ~300ms double-tap-zoom delay on some mobile browsers would directly cost points; a dual-`setInterval` pattern (80ms render loop + 250ms poll, both running the full 20-second round) is a legitimate re-render-storm candidate worth profiling.

**Recommended improvements:** Same `aria-label` and `recoverSession` fixes as Memory Flip; replace `transition-all` with an explicit property list; add `touch-manipulation`; add `tabular-nums` to score/timer displays; guard `animate-bounce` with `motion-reduce`.

**Relevant files:** `src/app/(protected)/games/rule-tap/page.tsx`, `packages/skill-games/src/components/rule-tap/rule-tap-board.tsx`, `rule-tap-score-panel.tsx`, `src/lib/games/useRuleTapGame.ts`.

---

### Major overlays (scored as states, not routes)

**`CartDrawer`** — Overall **6.0 (Needs Improvement)**. Best-in-class payment-failure recovery copy (distinguishes "paid but order failed" from a clean failure, offering a non-duplicating "Finish order" path) and clear earn-confirmation on success, undermined by: no `<label>` on any checkout field (name/phone/address/city — placeholder-only), no `safe-area-inset-bottom` handling (unlike sibling sheets that do this correctly) risking the CTA sitting under the iOS home indicator, no `overscroll-behavior: contain`, no focus trap/Escape, and — the most serious issue — a **hardcoded, undisclosed 130 KES/USD conversion rate** (`CartDrawer.tsx:463`) baked directly into the real payment total with no "≈"/approximate framing, computed with a *different* rounding function than the one used to build the `pricing` object a few lines earlier (`85`). Files: `src/components/CartDrawer.tsx`, `AddToCart.tsx`, `src/lib/cart.tsx`.

**`WalletPickerModal`** — Overall **4.5 (Poor)**. The only modal in the app with **zero** dialog semantics: no `role="dialog"`, no `aria-modal`, no `aria-labelledby`, no focus trap, no initial focus placement, no `Escape` handling, and no body-scroll lock. Because this modal is forced/blocking for any multi-wallet account and gates the user's own balance/activity view, this is a serious, not cosmetic, accessibility failure for assistive-technology users specifically (mouse/touch users are functionally unaffected, which is why this isn't scored as Critical). File: `src/app/(protected)/me/WalletPickerModal.tsx`.

**`PushOptInPrompt`** — Overall **7.8 (Good)**. The best-implemented overlay in the app: correct `role="dialog" aria-modal="true"`, scroll lock, Escape-to-close, correct `role="alert"` on its error state, correct loading-state button handling. Its only gaps: no true focus trap (focus can still tab past the dialog into page content behind it) and one hardcoded gradient. Use as the internal template for fixing the other five overlays. File: `src/components/PushOptInPrompt.tsx`.

---

## 5. Cross-App Accessibility Audit

Findings grouped by pattern; "systemic" means observed in 3+ independent files, implying a root-cause (usually: no shared primitive) rather than a one-off oversight.

1. **Weak/inconsistent focus indicators — systemic.** `grep` confirms `outline-none` appears in 18 files. Several correctly pair it with `focus-visible:ring-2 focus-visible:ring-akiba-teal` (`MerchantFilters.tsx:205`, `HomeIntentSearch.tsx:71`, `join/page.tsx`, `login/page.tsx` — though the latter two use `:focus` not `:focus-visible`, so their ring shows on mouse click too). Most do **not**: `ShopFilters.tsx:60`, `UsernameEditor.tsx:78`, all six text inputs in `CartDrawer.tsx` (`383-428`), `CountryEditor.tsx:43`, `SetPasswordForm.tsx:78,86` fall back to a bare 1px border-color change on focus with no ring — a genuinely weak indicator for low-vision users, and the literal "`outline-none` without a real replacement" anti-pattern the guideline names explicitly. `ButtonLink.tsx`, the app's nominal shared button primitive, has **no** `focus-visible` styling at all.

2. **No accessible modal/dialog primitive anywhere in the dependency tree — systemic, root cause.** `package.json` has no Radix UI, Headless UI, or `focus-trap-react`. Confirmed hand-rolled, inconsistent modal/sheet implementations: `CartDrawer`, `WalletPickerModal` (worst — zero dialog semantics), `ProfileQuickActions` sheet, `GetVoucherButton` confirm sheet, `MerchantFilters` `FiltersSheet`, `PushOptInPrompt` (best — see above). **None** of the six implement a real focus trap; **none** reliably return focus to the triggering element on close.

3. **`aria-live` used correctly in only 2 of ~15 places that need it — systemic.** Correct: `ReferralsPageClient.tsx:132-135` (copy-confirmation), `LocationOptIn.tsx:62` (denied-state). Missing, despite a clear async state change: `AkibaPassCard.tsx` regen warning/error, `CountryEditor.tsx` save error, `SetPasswordForm.tsx` error, `DisputeButton.tsx` error, `RecoveryBanner.tsx` error, `LinkedWallets.tsx` error, `UsernameEditor.tsx` save status, `WalletPickerModal.tsx` error, `ConfirmReceiptAction.tsx` success/reward confirmation, `CartButton.tsx` count badge, `AddToCart.tsx` "Added to cart," `QuestsPageClient.tsx` balance update after claim, `join/page.tsx`/`login/page.tsx` errors.

4. **Icon-only buttons without `aria-label` — systemic, but partially mitigated.** `CartButton.tsx` gets this right (`aria-label="Open cart"`). Failing: `PassFab` (`NavLinks.tsx:144-156` — the single most prominent mobile-only interactive element in the app), `SignOutButton.tsx:36` (label is `hidden sm:inline`, so on mobile the button is icon-only with no `aria-label` at all), `AkibaPassCard.tsx`'s regenerate button loses its accessible name entirely while `regen` is true, `CartDrawer.tsx:321,323,324`'s quantity Minus/Plus/Trash buttons.

5. **Placeholder-as-only-label — systemic, 8+ distinct fields.** `SetPasswordForm.tsx` (2 fields), `UsernameEditor.tsx`, `CountryEditor.tsx`'s `<select>`, `DisputeButton.tsx`'s textarea, `RecoveryBanner.tsx` (name + phone), `CartDrawer.tsx` (4+ checkout fields), `HomeIntentSearch.tsx` (mitigated — this one has a correct `sr-only` label). None of the failing fields have `htmlFor`/`id` pairs or `aria-label`.

6. **Two structurally identical tab UIs, only one accessible.** `QuestsPageClient.tsx:112-127` correctly implements `role="tablist"`/`role="tab"`/`aria-selected`. `VoucherTabs.tsx:107-122`, the visually identical pattern, has none of it. `LeaderboardSection.tsx:53-66` also lacks it.

7. **Both mini-games are keyboard-focusable but not screen-reader-playable.** Real `<button>` tiles (positive), but `aria-label`s never disclose the actual game-relevant state (symbol/color) — a "correct mechanics, wrong content" failure unique to this cluster and the most severe accessibility finding tied to actual gameplay in the app.

8. **No skip-to-content link anywhere** (confirmed absent globally) — an explicit, named guideline requirement with zero implementation.

9. **Heading hierarchy gaps:** `/me` has no `<h1>` (`me/page.tsx:104-258`); several now-dead marketing components used non-semantic `<div>` "01"–"06" step numbering instead of `<ol>/<li>` (moot while unused, but worth fixing if ever resurrected).

10. **What's already correct and should be the template going forward:** `ReferralsPageClient.tsx` (focus-visible + aria-live), `QuestsPageClient.tsx` (tab semantics), `PushOptInPrompt.tsx` (dialog semantics), `RewardProgressBar.tsx` (`role="progressbar"` with full `aria-valuetext`), `MerchantValueCard.tsx` (correct decorative-vs-informational `alt`/`aria-hidden` split), `ConfirmReceiptAction.tsx` (respects `Notification.permission === "denied"`, never re-prompts).

---

## 6. Cross-App Mobile UX Audit

Akiba Pass is correctly built mobile-first at the layout level (bottom nav, safe-area padding on the root layout, `viewportFit: "cover"`), but several specific gaps undercut that intent:

- **A functional control is removed entirely on mobile.** `CountryEditor`/interest chips on `/me` (`me/page.tsx:216-226`, `hidden ... sm:flex`) — on the device class this app is designed for first, users cannot edit "where do you shop," which also feeds a quest verifier.
- **`InstallPrompt`'s iOS detection is broken for modern hardware.** `isIOS()` (`InstallPrompt.tsx:23-26`) matches only `/iphone|ipad|ipod/i` against the UA string; since iPadOS 13, Safari's default UA identifies as `"Macintosh"`. Combined with `beforeinstallprompt` never firing on Safari, **iPads on default settings get no install prompt at all.**
- **`CartDrawer` has no safe-area handling**, unlike its sibling sheets (`FiltersSheet`, `GetVoucherButton`'s confirm sheet) which correctly add `pb-[calc(...+env(safe-area-inset-bottom))]` — real risk of the checkout CTA sitting under the iOS home indicator during the highest-stakes flow in the app.
- **Horizontal-scroll rails are swipe/drag-only** with no arrow-button alternative, no scroll-snap, and no trailing fade signaling more content exists off-screen: `MerchantRail.tsx:26`, `DiscoveryFeed.tsx:43`'s filter-chip row, `CategoryGrid`. At 320–360px widths this is the most likely place for content to feel clipped/truncated with no visual cue.
- **Rule Tap has no `touch-action: manipulation`** on its tiles — a genuine fairness/feel risk since this is a timing game where a ~300ms double-tap-zoom delay on some mobile browsers directly costs points.
- **`BottomNav` labels render at `text-[10px]`** (`NavLinks.tsx:126`) — functionally labeled (not icon-only), but close to the practical floor for mobile legibility; worth a second look during any nav redesign.
- **`PassFab`, the app's single most prominent mobile-only control**, has no `aria-label` (see §5.4).
- **What's already correct:** the root layout's `pb-[calc(4rem+env(safe-area-inset-bottom))]` (`layout.tsx:57`) correctly reserves space for `BottomNav` + the home indicator; `FiltersSheet` and `GetVoucherButton`'s sheet both correctly handle safe-area insets; `MerchantFilters`' near-me geolocation flow and `LocationOptIn`'s permission handling are both well-built for touch/mobile use; M-Pesa phone input correctly uses `type="tel"`.

---

## 7. Cross-App Performance Audit

Distinguishing real, observed problems from theoretical ones, per the brief's instruction not to recommend premature optimization.

**Real, worth fixing:**
- **DM Sans is loaded via a render-blocking `@import url(...)` in `globals.css:1`**, not `next/font/google`. This is a concrete, well-understood Next.js anti-pattern (no self-hosting, no automatic preload, no `font-display` control, and it's a genuine extra render-blocking network request on every page load). Confirmed via grep: `next/font/google` is used **nowhere** in the codebase.
- **`font-poppins` is referenced throughout the games UI but never loaded anywhere** — not a performance issue per se, but every game screen is silently rendering in the wrong (fallback) font, which is both a visual-consistency bug and, if fixed by simply adding another `@import`, would compound the font-loading performance issue above. Fix both together via `next/font/google`.
- **Every primary navigation link uses raw `<a href>` instead of `next/link`'s `<Link>`** (`SiteHeader.tsx`, `NavLinks.tsx` — all of `BottomNav`, the desktop tabs, the Pass pill, `PassFab`). Because this is the single highest-frequency interaction pattern in the app, every screen transition through primary nav forces a full page reload instead of a prefetched client-side transition — a systemic, not isolated, perceived-performance cost.
- **`/shop` fetches all store-active merchants unboundedly** (`shop/page.tsx:22-57`) with client-side-only filtering, in contrast to `/merchants`' server-paginated approach — a real scalability gap that will get worse as merchant count grows, not just a style inconsistency.
- **No route-level `loading.tsx`/`error.tsx` boundaries anywhere in `src/app`** (confirmed). Several pages `await` their entire data fetch before returning any markup (`VisitorLanding.tsx:13-17`, `MemberHome.tsx`), meaning a slow backend response is a blank tab, not a skeleton — a real perceived-performance issue given how consistently it recurs.
- **Rule Tap's dual `setInterval` pattern** (`useRuleTapGame.ts:151-161` at 80ms + `164-170` at 250ms, concurrently, for the full 20-second round, each recomputing an `activeTiles` `useMemo`) is a legitimate re-render-storm candidate worth profiling during the highest-frequency-interaction game in the app.
- **Raw `<img>` instead of `next/image` almost everywhere** (merchant logos, voucher images, product photos, avatars) — no automatic responsive sizing, no automatic lazy-loading below the fold, real CLS risk on pages with many images (merchant grids, product grids).

**Confirmed non-issues / not worth premature optimization:**
- List sizes are currently well within reason for the app's actual scale — `/me/activity`, `/me/orders`, `/me/notifications` all cap at 50 items (no virtualization needed yet, though pagination is still recommended for UX reasons, not performance ones); merchant/voucher grids are either server-paginated (`/merchants`) or currently small enough that client-side rendering isn't the bottleneck.
- `RewardProgressBar`'s width animation uses pure CSS percentage (not `getBoundingClientRect`), which is the correct approach — flagged in §3 only as a minor `width`-vs-`transform` animation-cost nitpick, not a real problem at its scale.
- No evidence of unnecessary re-render storms outside the Rule Tap dual-interval case above; most client components are appropriately scoped.

---

## 8. Navigation & Information Architecture Audit

**URL state is the single most repeated systemic gap after accessibility.** Only one filter/tab UI in the entire app — `/merchants`' `MerchantFilters.tsx` — correctly syncs its state to the URL via `router.replace`. Every structurally similar control elsewhere uses local `useState` only, meaning refresh, back-button, and shared links all silently discard the user's selection:
- `ShopFilters.tsx` (search/country/category on `/shop`) — no URL sync at all.
- `VoucherTabs.tsx` (Available/Active/Used/Expired) — tab resets to "Available" on refresh/shared link.
- `LeaderboardSection.tsx` (Memory Flip/Rule Tap leaderboard toggle) — reads the URL on initial load but never writes back on interaction, so the `/games/leaderboard` redirect's own `?gameType=` deep-link contract breaks the moment a user touches the tabs.
- `DiscoveryFeed.tsx`'s category filter — lower stakes (marketing surface) but same gap.

**`CartDrawer`'s open/checkout-step state is 100% in-memory.** Cart *items* persist via `localStorage`, but the drawer's open/closed state and which checkout step the user is on do not — a mid-checkout refresh (accidental pull-to-refresh is common on mobile) silently discards delivery-details/payment-in-progress state entirely, dropping the user back to step one with their cart intact but their progress gone.

**Route duplication (a real IA problem, not a filing quibble):** `/merchants` and `/shop` are two independently-built "browse merchants" surfaces with different card components, different filter architectures, and different data-freshness contracts, for what a user experiences as one task. `/merchants/[slug]`'s embedded "Shop online" section and the standalone `/shop/[slug]` route describe the **same merchant's product catalog** via two different URLs with two different layouts and two different pagination behaviors (4-per-page on the merchant profile vs. all-at-once on `/shop/[slug]`). A user bouncing between "Merchants," "Shop & Earn," and a quest CTA that lands on `/vouchers` could reasonably wonder if these are three different apps. This should be resolved (pick one canonical surface, or clearly differentiate their purpose in the IA and cross-link them) before further building on either.

**What's already correct:** `resolveActivePrimary()` (`NavLinks.tsx:24-36`) is a well-engineered, explicit route-family map (not a naive `startsWith`) that correctly avoids `/me` being falsely marked active under `/merchants`, and correctly treats `/pass` as a one-tap action rather than a nav destination — genuinely good IA discipline, documented inline with spec references. `/join`, `/login` correctly preserve `?next=` through the auth flow. `/my-vouchers` and `/games/leaderboard` are clean, minimal legacy-URL-compatibility redirects that preserve query params. Server-rendered pages that do the right defensive `try/catch`-per-fetch thing (`/earn`, `/quests`'s polling, `/merchants`) never break outright even when a downstream service is degraded.

---

## 9. User Journey Review

**Journey 1 — New user (open app → understand → find something useful → engage):** Strong. `VisitorLanding`'s `<h1>` + immediate search communicates purpose in under 2 seconds with no sign-up wall. Friction: no loading/error state if the initial feed fetch is slow or fails (§4 `/`).

**Journey 2 — Returning user (open app → check balance → decide next step):** The weakest journey in the audit. The Miles balance — the entire reason a returning member opens the app — can **silently vanish** on `MemberHome` if its backend fetch fails (§4 `MemberHome`, the audit's top finding). When it does render, the pending-vs-settled distinction is inconsistent (§4 `/me`).

**Journey 3 — Earn (discover merchant → understand mechanic → shop/scan → confirmation):** Add-to-cart confirmation is visual-only (no `aria-live`); checkout total confirmation is undermined by a hardcoded, undisclosed FX rate (§4 `CartDrawer`); success/failure states are genuinely well-designed (distinct payment-failed-vs-order-failed recovery paths). Friction: `/merchants` vs. `/shop` route duplication means "discover a merchant" can start from two structurally different surfaces with different filtering capabilities.

**Journey 4 — Redeem (browse rewards → select → understand cost → redeem → proof):** Strong cost confirmation (`GetVoucherButton`'s confirm sheet itemizes ledger-vs-on-chain Miles before charging — directly answers "what confirms cost"); strong success proof (`/vouchers/[id]`'s status badges + QR). Friction: the confirm sheet has no Escape/focus-trap/backdrop-dismiss; voucher-title truncation is inconsistent between cards, risking layout breakage on long titles.

**Journey 5 — Merchant discovery:** Well-served by `/merchants`' URL-synced filters, near-me geolocation, and category/city filters — the best-executed discovery surface in the app. Undermined at the IA level by `/shop`'s parallel, weaker implementation of the same task.

**Journey 6 — Voucher discovery:** Adequate but thin — `/vouchers` has no search/filter mechanism at all, so a growing catalog has no way to narrow by merchant or category.

**Journey 7 — Insufficient Miles:** Exists (`GetVoucherButton.tsx:14`, HTTP 422 → "Not enough AkibaMiles") but is the **only** error branch in that component without a follow-up action — 401 gets "Sign in," 400/wallet gets "Go to profile," insufficient-balance gets no nudge toward `/earn` or `/quests` despite being the single most likely real-world failure for this specific action.

**Journey 8 — Empty/new account:** Generally well-handled — `ActivityFeed`'s empty state (icon+title+hint+CTA) is a clean, reusable pattern; `/me/orders` empty state offers a clear "Shop & Earn" CTA; `MerchantRail` correctly doesn't render empty sections at all (explicitly documented per spec). Weak spot: `/me/notifications`' empty-state copy undersells what will actually populate the feed.

**Journey 9 — Error/offline:** A genuine strength area — `VoucherDetailView`'s pending-purchase reconciliation and `CartDrawer`'s payment-failure recovery are both unusually sophisticated for a consumer app (distinguishing "money moved, order didn't" from a clean failure, with explicit non-destructive recovery paths). Undermined by the app-wide absence of route-level `error.tsx` boundaries for anything not explicitly hand-built, and by `LocationOptIn`'s silent disappearance after a granted-but-failed fetch (§4 cross-references).

---

## 10. Prioritized Issue Register

Sorted P0 → P1 → P2 → P3. Every row is grounded in a specific file/line from the research above.

### P0 — Critical

| # | Issue | Route/Component | Impact | Recommended Fix |
|---|---|---|---|---|
| 1 | Rewards/balance snapshot silently disappears (no error, no retry) when its fetch fails | `MemberHome.tsx:57-64`, `src/lib/home/feed.ts:235-253` | Loyalty app's single most trust-critical number can vanish with zero explanation on the returning-member home screen | Pass through `{ rewards: { error: true } }` on rejection; render an explicit "Couldn't load your balance — tap to retry" state |
| 2 | `WalletPickerModal` has zero dialog semantics (no `role="dialog"`, no focus trap, no scroll lock, no Escape) | `src/app/(protected)/me/WalletPickerModal.tsx:42-110` | Blocks assistive-technology users from a modal that gates access to their own balance/activity for any multi-wallet account | Add `role="dialog" aria-modal="true" aria-labelledby`; trap focus; lock body scroll; handle Escape; add `aria-pressed` to wallet options |
| 3 | Both mini-games' `aria-label`s never disclose actual tile state (symbol/color) | `packages/skill-games/.../memory-card.tsx:40`, `rule-tap-board.tsx:49` | Core gameplay mechanic is unplayable by screen-reader users despite correct `<button>` semantics | Include the actual symbol/color value in the `aria-label`, e.g. `` `Revealed card: ${value}` `` |
| 4 | Hardcoded, undisclosed 130 KES/USD conversion rate baked into real checkout total, computed with two different rounding functions in two places | `src/components/CartDrawer.tsx:85,463` | Systematic mispricing risk with zero user-visible disclosure that the KES amount is an approximation; a real-world FX move silently mis-prices every M-Pesa checkout | Disclose as "≈ KES X" or source a real live rate; use one shared rounding function for the figure everywhere it's computed/shown |

### P1 — High

| # | Issue | Route/Component | Impact | Recommended Fix |
|---|---|---|---|---|
| 5 | No `<form>`/Enter-to-submit anywhere in `/join` or `/login` | `(auth)/join/page.tsx:93-172`, `(auth)/login/page.tsx:78-222` | Enter key does nothing; mobile keyboard "Go" action fails; undermines the "counter-time" pitch of `/join` specifically | Wrap fields in `<form onSubmit>` |
| 6 | Form fields with no `<label>`/`aria-label`, placeholder-only | `join/page.tsx:115,130`, `login/page.tsx:121,137,165`, `SetPasswordForm.tsx:72,80`, `UsernameEditor.tsx:73`, `CountryEditor.tsx:40`, `DisputeButton.tsx:56`, `RecoveryBanner.tsx:107,110`, `CartDrawer.tsx:393-408` | Screen readers cannot associate a name with the field; labels aren't clickable | Add `id`/`htmlFor` pairs or `aria-label` to every listed field |
| 7 | Async success/error text with no `aria-live` (15+ instances) | See §5.3 full list | Screen-reader users get no announcement of save success, save failure, item-added, claim-succeeded, etc. | Adopt `ReferralsPageClient.tsx:132-135`'s proven `aria-live="polite"` pattern as the shared convention |
| 8 | No focus trap/Escape/scroll-lock on 5 of 6 overlays | `CartDrawer`, `ProfileQuickActions` sheet, `GetVoucherButton` confirm sheet, `MerchantFilters` `FiltersSheet`, `WalletPickerModal` (also P0 above) | Keyboard/AT users can tab out of an open overlay into background content; no reliable dismiss path | Build one shared accessible Modal/Sheet primitive (template: `PushOptInPrompt.tsx`) and migrate all five |
| 9 | Filter/tab UI state not reflected in the URL | `ShopFilters.tsx`, `VoucherTabs.tsx:76`, `LeaderboardSection.tsx:56-59` | Refresh, back-button, and shared links silently discard the user's filter/tab selection | Copy `MerchantFilters.tsx:78-101`'s `router.replace` pattern onto all three |
| 10 | Icon-only buttons missing `aria-label` | `PassFab` (`NavLinks.tsx:144-156`), `SignOutButton.tsx:36` (mobile), `AkibaPassCard.tsx:256-264` (during regen), `CartDrawer.tsx:321,323,324` | Unlabeled controls to screen readers, including the app's most prominent mobile-only action | Add `aria-label` to each; keep a persistent `sr-only` label on `AkibaPassCard`'s regenerate button regardless of busy state |
| 11 | `CountryEditor`/interest chips completely hidden on mobile (`hidden ... sm:flex`) | `me/page.tsx:216-226` | A functional profile control (also a quest verifier field) is unreachable on the primary device class for a mobile-first PWA | Render on mobile too — move into a reachable settings location if space is the concern |
| 12 | `/shop`, `/shop/[slug]` duplicate `/merchants`, `/merchants/[slug]` with a weaker (unbounded fetch, no URL sync, no error boundary) implementation | `shop/page.tsx`, `ShopFilters.tsx`, `shop/[slug]/page.tsx` | Two inconsistent "browse merchants" experiences for one product concept; scalability risk as merchant count grows | Consolidate onto one canonical surface (recommend `/merchants`' architecture) or explicitly differentiate and cross-link the two in the IA |
| 13 | Recovering a session that outlives a refresh is dead code | `src/lib/games/clientTransport.ts:136` (`recoverSession`, never called) | A refresh/background mid-game silently strands the round with zero acknowledgment | Wire `recoverSession()` into both game pages' mount logic |
| 14 | `auth/callback`'s `?error=auth_failed` is never read by `/login` | `auth/callback/route.ts:28`, `login/page.tsx` | A failed magic-link/OAuth callback drops the user on a blank form with zero explanation | Read `searchParams.get("error")` and surface explanatory copy |
| 15 | Two structurally identical tab UIs, only one accessible | `VoucherTabs.tsx:107-122` (missing) vs. `QuestsPageClient.tsx:112-127` (correct) | Screen-reader users get no tab semantics on the voucher catalog | Copy `QuestsPageClient`'s `role="tablist"` implementation |
| 16 | `RecoveryBanner` can't distinguish "still loading" from "nothing to recover" | `me/orders/RecoveryBanner.tsx:28-33,63` | A user who just paid sees nothing during the fetch round-trip, indistinguishable from "your payment didn't register" | Differentiate `null` (loading) from `[]` (confirmed none) |
| 17 | `InstallPrompt`'s iOS detection excludes modern iPads | `InstallPrompt.tsx:23-26` | iPads on default Safari settings never see an install prompt | Add a touch-point/platform heuristic alongside the UA check |
| 18 | `HomeIntentSearch` has no submit affordance beyond Enter | `HomeIntentSearch.tsx:51-99` | Touch users without a convenient "go" key cannot submit the home search at all | Wrap in `<form>`; make the search icon a real submit button |
| 19 | Insufficient-Miles error has no follow-up action | `GetVoucherButton.tsx:14` (422 branch) | The single most likely real-world redemption failure gets no "earn more" nudge, unlike the other three error branches | Add a link to `/earn` in the 422 error state |
| 20 | `RewardBadge` and other voucher-cost displays render Miles as literal text instead of `MilesAmount` | `me/orders/page.tsx:298-304`, `VoucherCard.tsx:41-44`, `VoucherTabs.tsx` `AvailableCard`, `shop/[slug]/page.tsx:300-303` | Breaks the project's own established brand convention (`[symbol]amount`, never bare text) in exactly the place — redemption/reward cost — where it matters most | Replace with `<MilesAmount amount={...} />` everywhere |

### P2 — Medium (representative sample; full detail in the per-agent research is available on request — themes below recur across many files)

- Hardcoded `$`/`KES` string concatenation instead of `Intl.NumberFormat`, and locale-less `toLocaleString()`/date formatting: `ProductGrid.tsx:41`, `shop/[slug]/page.tsx:271`, `VoucherTabs.tsx:197-204`, `VoucherDetailView.tsx:56-60,347-348`, `me/orders/page.tsx:211`, `RecoveryBanner.tsx:76-78`, `MilesIcon.tsx:64` (root cause — fix here for wide reach).
- No `tabular-nums` anywhere in the app (zero occurrences, confirmed by grep) — most consequential on `/me`'s balance (`me/page.tsx:148,153`), `ReferralsPageClient.tsx` stats row, `VoucherDetailView.tsx:401-405`'s countdown, and every games score/timer display.
- `STATUS_CONFIG` in `me/orders/page.tsx:13-59` uses raw Tailwind palette colors instead of semantic tokens (7 of 8 statuses off-token).
- Raw `<img>` instead of `next/image`, no explicit dimensions: merchant/voucher/product images across `merchants/[slug]/page.tsx`, `ProductGrid.tsx`, `shop/[slug]/page.tsx`, `ShopFilters.tsx`, `VoucherTabs.tsx`, `VoucherDetailView.tsx`, `CartDrawer.tsx`, `me/page.tsx:123-125`.
- Toggle-chip components (`FilterChip` in `MerchantFilters.tsx` vs. `ShopFilters.tsx` vs. `DiscoveryFeed.tsx`) inconsistently implement `aria-pressed`.
- Hardcoded off-brand hex colors: `#1E7E8D` (4 files), `PushOptInPrompt.tsx:182`, `EarnCards.tsx:12,15`, games' full palettes and backgrounds — see §3.
- `ExpandableDescription.tsx:21-27`'s "See more" toggle has no `aria-expanded`.
- `PushNotificationSettings.tsx:95-106` updates a toggle optimistically with no rollback on PATCH failure.
- `me/notifications` empty-state copy undersells what actually populates the feed.
- `/me/activity`, `/me/orders`, `/me/notifications` all hard-cap at 50 items with no pagination and no "showing your last 50" disclosure.
- Two independent icon libraries (`lucide-react` vs. `@phosphor-icons/react`) visible back-to-back between the games launcher and actual gameplay.
- Two independent button implementations (`ButtonLink.tsx` vs. `@akiba/skill-games`'s `Button`).
- No `text-balance` on `SectionHeader.tsx:33`'s large headings.
- Horizontal-scroll rails with no arrow-button alternative or scroll-snap: `MerchantRail.tsx:26`, `DiscoveryFeed.tsx:43`.

### P3 — Low (polish; representative sample)

- Literal `"..."`/bare `"…"` loading labels: `PushOptInPrompt.tsx:200`, `ConfirmReceiptAction.tsx:125`.
- `SignOutButton.tsx` fires immediately with no confirmation (defensible for a low-stakes action, but a deviation from the letter of the destructive-action guideline).
- Duplicate `<title>` metadata between `/quests` and `/earn`.
- Raw emoji instead of icons in `LinkedWallets.tsx:95,145`.
- Manifest's "Games" shortcut missing a `description` (`manifest.ts:33-36`) vs. "My Pass"'s complete metadata.
- Dead-code marketing components (`AppBanner.tsx`, `WalletPersonalization.tsx`, `Hero.tsx`, `HowItWorks.tsx`, `FooterCTA.tsx`, `PartnerCTA.tsx`, `PartnerStrip.tsx`, `BalanceDisplay.tsx`) — delete or re-wire; `BalanceDisplay.tsx` specifically is a latent trust bug if ever reactivated as-is (computes balance differently than `getUserBalance()`).
- `z-40`/`z-50`/`z-[60]`/`z-[70]` — no documented z-index scale.
- `ProductGrid.tsx`, `orders/page.tsx` back-links use raw `<a>`/`router.push` instead of `next/link`.

---

## 11. Top 10 Highest-Leverage Improvements

Ranked by UX impact relative to implementation effort.

1. **Fix `MilesAmount` (locale + `tabular-nums`) in one file.** `src/components/MilesIcon.tsx:62-65` — add `"en-KE"` to `.toLocaleString()` and `tabular-nums` to the numeral span. This is the most widely-reused number-rendering primitive in the app (home, `/me`, orders, notifications, referrals, and via `MasteryResultSummary`, the games). **Scope: XS.**
2. **Fix `MemberHome`'s silent balance-vanish failure.** Surface an explicit error/retry state instead of hiding the section. Protects the core trust moment of the entire product. **Scope: XS–S.**
3. **Give `WalletPickerModal` real dialog semantics.** `role="dialog"`, focus trap, scroll lock, Escape, `aria-pressed` on options — currently the worst-implemented overlay in the app and gates the balance view. **Scope: S.**
4. **Build one shared accessible Modal/Sheet primitive and migrate the other five overlays onto it.** Template already exists in-house (`PushOptInPrompt.tsx`'s dialog semantics + `ProfileQuickActions.tsx`'s sheet chrome). Fixes `CartDrawer`, `WalletPickerModal`, `FiltersSheet`, and `GetVoucherButton`'s confirm sheet's focus-trap/Escape/scroll-lock gaps in one pass instead of five. **Scope: M–L.**
5. **Disclose or fix the hardcoded FX rate in `CartDrawer`.** Real-money trust issue with an easy first step (add "≈" and a disclosure line) and a more correct second step (single shared rounding function, ideally a live/periodically-updated rate). **Scope: S.**
6. **Apply the `MerchantFilters.tsx` URL-sync pattern to `ShopFilters.tsx`, `VoucherTabs.tsx`, and `LeaderboardSection.tsx`.** The pattern is proven and already shipped once — copying it fixes the back-button/refresh/share-link breakage that's currently the norm rather than the exception across filter/tab UIs. **Scope: M.**
7. **Add labels to every placeholder-only form field app-wide.** A single, mechanical, low-risk pass across the ~8 fields cited in §10 P1 #6 — fixes a real WCAG-level failure repeated across the highest-stakes forms in the app (checkout, password, dispute, delivery recovery). **Scope: S–M.**
8. **Fix the games' `aria-label`s to disclose actual tile state.** Two one-line changes (`memory-card.tsx:40`, `rule-tap-board.tsx:49`) turn "keyboard-focusable but unplayable" into genuinely screen-reader-playable games. **Scope: XS.**
9. **Load DM Sans via `next/font/google` and fix the never-loaded `font-poppins` reference.** Removes a render-blocking `@import`, adds proper preload/`font-display`, and fixes a real rendering bug where every game screen silently uses the wrong typeface. **Scope: S.**
10. **Make `ButtonLink.tsx` a genuinely flexible primitive** (optional icon, `loading`/`disabled` states, a `focus-visible` ring) and migrate the ~10+ hand-rolled buttons in `games/page.tsx`, `LocationOptIn.tsx`, `ReferralCard.tsx`, `RewardsSnapshot.tsx` onto it. Highest long-term design-system leverage item on this list — every future button built on top of it inherits correctness for free. **Scope: M.**

---

## 12. Design System Improvements

**Standardize as reusable primitives (highest priority first):**

1. **`<Input>`/`<Label>`/`<Select>`** — a single form-field primitive with baked-in correct `focus-visible:ring-2 focus-visible:ring-akiba-teal`, `id`/`htmlFor` wiring, and `aria-describedby` for error text. Every hand-rolled `<input className="rounded-xl border border-akiba-line ...">` across `join`, `login`, `SetPasswordForm`, `CountryEditor`, `UsernameEditor`, `DisputeButton`, `RecoveryBanner`, `CartDrawer`, `HomeIntentSearch`, `MerchantFilters`, `ShopFilters` should consolidate onto it.
2. **`<Dialog>`/`<Sheet>`** — one accessible base (focus trap, `role="dialog"`, Escape, scroll lock, focus-return-on-close, `overscroll-behavior: contain`) built from the correct parts already present in `PushOptInPrompt.tsx` and `ProfileQuickActions.tsx`. Consolidates `CartDrawer`, `WalletPickerModal`, `FiltersSheet`, and `GetVoucherButton`'s confirm sheet.
3. **`<Button>`** — reconcile `ButtonLink.tsx` (hub-page) and `@akiba/skill-games`'s `Button` (`cva`-based) into one shared primitive, or at minimum bring `ButtonLink.tsx` up to parity (optional icon, `loading`/`disabled`, `focus-visible` ring) so it stops being bypassed by ~10+ ad hoc implementations.
4. **Semantic status-color tokens** (`akiba.status.{info,success,warning,danger}`) — migrate `me/orders/page.tsx`'s `STATUS_CONFIG` and the various ad hoc `red-*`/`amber-*`/`green-*` usages onto them.
5. **`<AsyncStatus>` / a shared `aria-live` wrapper** — codify the one correct existing instance (`ReferralsPageClient.tsx:132-135`) as a reusable pattern/component so the next 15 places that need it get it by default.
6. **A single "merchant card" component** — converge `MerchantValueCard.tsx` (already the gold standard), `ShopFilters.tsx`'s inline `MerchantCard`, and any others onto one implementation, ideally eliminating the need for `/shop`'s parallel surface entirely.
7. **A single "Miles cost" display pattern** — every place a voucher/reward cost is shown should use `MilesAmount`, never bare stacked numerals (currently violated in `VoucherCard.tsx`, `VoucherTabs.tsx`'s `AvailableCard`, and `shop/[slug]/page.tsx`'s `VoucherTemplateRow`).
8. **Currency formatting** — centralize on `Intl.NumberFormat` inside `src/lib/pricing.ts`'s `formatUSD()` (currently `` `$${n.toFixed(2)}` ``) and have every call site actually import and use it instead of re-deriving the string inline (`orders/page.tsx`, `RecoveryBanner.tsx`, `ProductGrid.tsx`, `shop/[slug]/page.tsx`, `VoucherTabs.tsx`, `VoucherDetailView.tsx`, `CartDrawer.tsx` currently all reimplement it independently).
9. **A documented `z-*` scale** — replace the current `z-40`/`z-50`/`z-[60]`/`z-[70]` ad hoc values with named layers (`z-nav`, `z-overlay`, `z-modal`, `z-toast`).
10. **One "track on mount" hook** — `ReferralCardViewTracker.tsx`, `SectionViewTracker.tsx`, `HomeViewTracker.tsx`, and `NextRewardViewTracker.tsx` are four near-identical "fire an analytics event once, render null" components; consolidate into a single `useTrackOnMount(event, props)` hook.

**Consolidate, don't add:** resolve `/merchants` vs. `/shop` and `/merchants/[slug]` vs. `/shop/[slug]` (§8) before building further on either; delete the eight confirmed dead-code files (§2) rather than letting them accumulate as a source of future confusion (`BalanceDisplay.tsx` in particular is an active trust-bug risk if ever reactivated without a rewrite, since it would show a different balance number than the rest of the app).

---

## 13. Suggested Implementation Plan

Sized as XS/S/M/L/XL per the brief (no calendar estimates — the codebase doesn't give enough signal for those, and the brief asked not to guess).

### Phase 1 — Critical fixes (accessibility, broken UX, mobile, serious navigation/state issues)

| Item | Scope |
|---|---|
| `WalletPickerModal` dialog semantics + focus trap + scroll lock (§10 P0 #2) | S |
| `MemberHome` balance-fetch-failure error/retry state (§10 P0 #1) | XS–S |
| Fix both games' `aria-label`s to disclose tile state (§10 P0 #3) | XS |
| Disclose/fix `CartDrawer`'s hardcoded FX rate (§10 P0 #4) | S |
| Add `<form>`/Enter-submit to `/join`, `/login`, `HomeIntentSearch` | S |
| Label every placeholder-only form field app-wide (§10 P1 #6) | S–M |
| Fix all icon-only buttons missing `aria-label` (`PassFab`, `SignOutButton` mobile, `AkibaPassCard` regen, `CartDrawer` qty buttons) | XS–S |
| Unhide `CountryEditor`/interest chips on mobile | S |
| Fix `InstallPrompt`'s iPad detection | XS |
| Read and surface `auth/callback`'s `?error=auth_failed` on `/login` | XS |

### Phase 2 — Consistency (design tokens, primitives, shared components, duplicated patterns)

| Item | Scope |
|---|---|
| Build shared `<Dialog>`/`<Sheet>` primitive; migrate `CartDrawer`, `FiltersSheet`, `GetVoucherButton` confirm sheet onto it | M–L |
| Build shared `<Input>`/`<Label>` primitive; migrate hand-rolled form fields | M |
| Bring `ButtonLink.tsx` to parity (icon-optional, loading/disabled, focus ring); migrate ad hoc buttons | M |
| Fix `MilesAmount` locale + `tabular-nums` (§11 #1) | XS |
| Define `akiba.status.*` tokens; migrate `STATUS_CONFIG` and ad hoc status colors | S |
| Fix Miles-symbol-convention violations (`RewardBadge`, `VoucherCard`, `VoucherTabs`, `VoucherTemplateRow`) | S |
| Centralize currency formatting on `Intl.NumberFormat` via `pricing.ts` | S–M |
| Reconcile the two icon libraries (`lucide-react` vs. `@phosphor-icons/react`) or document the split intentionally | S |
| Delete confirmed dead code, or re-wire if intended for reuse | S |
| Fix hardcoded off-brand hex colors app-wide (§3) | S–M |
| Consolidate the four "track on mount" components into one hook | XS |

### Phase 3 — UX refinement (information hierarchy, journeys, empty states, feedback, discovery)

| Item | Scope |
|---|---|
| URL-sync `ShopFilters`, `VoucherTabs`, `LeaderboardSection` (copy `MerchantFilters` pattern) | M |
| Add `loading.tsx`/`error.tsx` route boundaries app-wide | M |
| Add pagination beyond the 50-item cap for activity/orders/notifications | M |
| Add insufficient-Miles follow-up action in `GetVoucherButton`'s 422 state | XS |
| Add "what happens next" copy to the dispute flow | XS |
| Fix `RecoveryBanner`'s loading-vs-empty ambiguity | S |
| Resolve `/merchants` vs. `/shop` and `/merchants/[slug]` vs. `/shop/[slug]` duplication | L |
| Wire up `recoverSession()` for both games | S |
| Add `role="tablist"`/`role="tab"` to `VoucherTabs` and `LeaderboardSection` | S |
| Broaden `/me/notifications` empty-state copy | XS |
| Reconsider `RewardsSnapshot`'s balance-tile → `/games` link (mismatched information scent) | XS |

### Phase 4 — Polish and performance

| Item | Scope |
|---|---|
| Add `prefers-reduced-motion` support app-wide (currently zero usage) — games' flip/bounce animations, `pulse-glow` utility | S–M |
| Replace `transition-all` usages with explicit property lists | XS |
| Add `touch-action: manipulation` to game tiles and cards | XS |
| Add `text-balance` to `SectionHeader` and other large headings | XS |
| Add scroll-snap + fade-edge affordance to horizontal rails | S |
| Load DM Sans via `next/font/google`; fix the never-loaded Poppins reference (§11 #9) | S |
| Migrate raw `<img>` to `next/image` across merchant/voucher/product imagery | M |
| Migrate primary navigation from `<a href>` to `next/link`'s `<Link>` (`SiteHeader`, `NavLinks`) | S |
| Minor copy fixes: literal `"..."`/bare `"…"` loading labels, duplicate `<title>` between `/quests` and `/earn` | XS |
| Document a `z-*` scale and migrate ad hoc `z-[N]` values | XS |
