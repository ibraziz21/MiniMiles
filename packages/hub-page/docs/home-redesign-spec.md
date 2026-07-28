# Spec: Hub Home Redesign — Tool for Members, Pitch for Visitors

**Package:** `packages/hub-page`
**Status:** Ready for implementation

---

## Context

The current home (`src/app/page.tsx`) is a marketing landing page served to
everyone: hero copy, three explainer section cards, featured merchants,
"How it works" steps. Members see a pitch they've already accepted on every
visit, while the QR — the core gesture of the product — is buried in `/me`
(`AkibaPassCard`). Positioning rule for all copy in this spec: lead with
savings/rewards; Miles are the mechanism; **no chain names on commerce
surfaces** (no "cross-chain", "on-chain", "Base/Celo/MiniPay" in user copy).

**Decisions locked:**
- Split home by auth: members get a tool, visitors get a slim pitch.
- Explainer content relocates to a post-signup onboarding carousel that ends
  by revealing the user's QR.
- The full-screen Pass gets a **persistent nav slot** — one tap from anywhere.
- In-store poster scans get a fast-path signup, not the landing page.

## 1. Auth split (`src/app/page.tsx`)

Server component: check session via `lib/supabase/server`. Session →
`<MemberHome />`; none → `<VisitorLanding />`. No redirect — same URL, two
renders.

## 2. MemberHome (the tool)

Order, mobile-first:

### 2a. Pass card (compact) — always first
- Compact variant of `AkibaPassCard` (`app/(protected)/me/AkibaPassCard.tsx`
  already builds the QR + share/save PNG — extract the QR rendering into a
  shared component, keep `/me`'s full card untouched).
- Shows: small QR thumbnail, user label, "Show at the till — earn 1 Mile per
  100 KES".
- Tap → `/pass` (§4), full-screen.

### 2b. Balance, denominated
- Balance = chain + ledger (computation exists in `/me` page ~line 96 —
  extract into `lib/akiba/balance.ts`, reuse in both).
- Render as purchasing power, not a number alone:
  - Affordable deal exists: "**1,240 Miles** — enough for {cheapest attainable
    deal title}".
  - None affordable: "**80 Miles** — {n} more to unlock {cheapest deal}".
- Data: cheapest active voucher template by `miles_cost` (same source as the
  shop/deals queries). Tap → `/shop`.

### 2c. "Use it today" deals rail
- Horizontal rail, up to 6 active deals (template + merchant join, ordered:
  affordable-with-current-balance first, then by miles_cost asc).
- Card: merchant logo, deal label, Miles price; "Unlock with Miles" as the
  CTA verb everywhere (not "buy"/"redeem" inconsistently).
- Tap → existing deal/merchant page. "See all" → `/shop`.

### 2d. Vouchers strip (conditional)
- Only when the user holds active vouchers: "🎟 {n} active · {m} expiring
  soon" → `/vouchers`. Hidden otherwise.

Nothing else on MemberHome. Shop/Rewards/Quests discovery lives in the nav —
the home page must not re-advertise the navigation (that's what the current
three section cards do; they are removed for members).

## 3. VisitorLanding (the slim pitch)

- Headline: "Everyday rewards from the shops you love."
- Subline: "Save with vouchers, discounts and offers — earn AkibaMiles
  through purchases, challenges and games."
- One primary CTA: "Get your free Akiba Pass" → signup.
- Featured merchants row (existing `getFeaturedMerchants`) as social proof.
- Cut from current page: the three section cards, "How it works" steps
  (both move to onboarding §5). Keep the page to one screen.

## 4. `/pass` — full-screen Pass (persistent access)

- New protected route: full-screen `AkibaPassCard` (existing component),
  max brightness hint, cashier-facing.
- **Nav slot:** add "Pass" to `components/NavLinks.tsx` (both desktop LINKS
  and the mobile set), visually distinct (center/pill) — the product's core
  gesture is always one tap away. Till moments don't start from home.
- Unauthenticated hit → signup, then straight back to `/pass`.

## 5. Onboarding carousel (`/welcome`)

- Shown once after first signup (flag `onboarding_seen_at` on the hub user
  profile; skippable, never re-shown after skip).
- 4 slides — port content from react-app's `helpers/passOnboardingSource.ts`
  (Meet the Akiba Pass / Earn when you shop / Scan. Earn. Repeat. with the
  1-2-3 steps / final slide).
- **Final slide is the QR reveal**: "Your Pass is ready" + their live
  AkibaPassCard + "Show it next time you pay." CTA → MemberHome.
  Onboarding ends by handing the user the thing it promised.

## 6. In-store fast path (`/join?src=…`)

- Poster QRs point at `/join?src=leshan_poster_till` (distinct src per
  poster/location — pilot attribution).
- One screen: "Sign up in 1 minute — earn points on this purchase." Signup
  form only, no marketing scroll.
- After signup: **skip the carousel**, go straight to QR reveal ("Show this
  to the cashier now"), then `/welcome` is offered on next visit instead.
  Counter-time beats education — the pilot funnel (scan → signup → first
  earn) depends on this screen being fast.
- Persist `src` into the signup record (acquisition attribution).

## 7. Analytics

`home_view{variant: member|visitor}`, `pass_card_tap`, `pass_nav_tap`,
`balance_tap{affordable:boolean}`, `deals_rail_tap{template_id}`,
`vouchers_strip_tap`, `welcome_slide_view{i}`, `welcome_completed`,
`join_view{src}`, `join_completed{src, seconds_to_complete}`.

## 8. Acceptance criteria

- Logged-in: home shows pass card, denominated balance, deals rail; no
  explainer cards, no "How it works".
- Logged-out: one-screen pitch, single signup CTA.
- `/pass` reachable from nav on every page; back-and-forth preserves scroll.
- New signup sees `/welcome` once; final slide shows their real QR.
- `/join?src=x` → signup → QR reveal in ≤ 2 screens; src stored.
- No user-facing string contains "cross-chain", "on-chain", or a chain name
  on home, `/pass`, `/welcome`, or `/join`.
- Balance denomination correct in both states (affordable / not yet).

## 9. Open questions

1. Visitor landing: keep `/rewards` + `/quests` visible in nav for
   logged-out users, or collapse nav to Shop + Sign in until authenticated?
   (Lean: collapse — fewer doors, one funnel.)
2. `/pass` offline behavior: `AkibaPassCard` already has offline hints
   (WifiOff icon in imports) — confirm the QR renders from cache offline;
   till moments can't depend on connectivity.
