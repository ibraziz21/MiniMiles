# Spec: Verified Discovery and Merchant Acquisition V1

- **Primary package:** `packages/hub-page`
- **External merchant system:** Akiba-Platform merchant dashboard and APIs
- **Supporting packages:** `packages/admin-dashboard`, `supabase`
- **Status:** Proposed for product, design, data, privacy and engineering review
- **Date:** 2026-09-29
- **Related specs:** `home-redesign-spec.md`,
  `merchant-directory-in-store-discovery-spec.md`,
  `akiba-pass-navigation-rewards-earned-notifications-v1-spec.md`,
  `next-reward-progress-v1-spec.md`,
  `verified-discovery-market-readiness-hardening-spec.md`

---

## 0. Executive decision

Akiba will position Hub primarily as a **verified merchant discovery and
customer-acquisition network**. Loyalty remains a core differentiator, but it
supports the acquisition loop instead of being the product's opening promise.

The member promise becomes:

> Discover places people genuinely recommend, see what verified Akiba
> customers love there, and earn Miles when you choose to visit or buy.

The merchant promise becomes:

> Akiba helps new customers choose your business, shows what verified
> customers value, and gives those customers a reason to return.

The product loop is:

```text
Verified in-store earning event
        ↓
Short post-earn contribution
        ↓
Thresholded recommendations and product signals
        ↓
Discovery page and merchant decision page
        ↓
High-intent action and first verified purchase
        ↓
Miles, repeat visit and better merchant insight
```

This spec covers three connected product changes:

1. the `/` Discovery page;
2. the `/merchants/[slug]` merchant decision page; and
3. a new contribution flow for members who have authoritatively earned Miles
   at a merchant.

External social-post collection is retained as Phase B. It is valuable but
must not block the structured, first-party verified-data loop in Phase A.
First-party customer photos are part of the verified recommendation scope, but
ship behind their own moderation and media-processing gate.

---

## 1. Product problem

Loyalty software alone is not a sufficiently differentiated merchant
proposition. Many businesses already have, or believe they can build, their own
points, stamps or CRM programme.

Individual merchants cannot as easily create:

- cross-merchant consumer discovery;
- trusted recommendations backed by verified commercial activity;
- a portable consumer identity and reward balance;
- product-level demand signals across first-time and returning customers;
- acquisition attribution from discovery through to a verified earning event;
- a shared network in which one merchant's audience can discover another.

The current Hub home is already intent-first, but its strongest visible claim
is still that a merchant participates in Akiba and may have vouchers. The
rendered default rail answers **“Which merchants are on Akiba?”**, not
**“Which merchant should I choose, what should I get, and why should I trust
this recommendation?”**

V1 closes that gap without turning Akiba into an anonymous review site, a
full marketplace or a social network.

---

## 2. Goals, non-goals and launch hypothesis

### 2.1 Goals

- Help a mobile user decide where to go or buy in under one minute.
- Give every recommendation a truthful, plain-language reason.
- Derive recommendation contributions only from people with authoritative
  in-store earning events at that merchant.
- Collect useful structured feedback in under 30 seconds.
- Make the first contribution question answerable with one thumb and one tap.
- Keep public browsing available without authentication.
- Convert discovery into measurable first-time merchant purchases.
- Give merchants aggregate insight into recommended products, repeat
  behaviour, party context, experience tags, spend bands and offer
  opportunities.
- Build a customer-photo gallery on qualified merchant profiles without
  requiring merchant product or media setup.
- Let merchants make otherwise-empty profiles visually useful with clearly
  labelled business and product media, without presenting that media as
  independent customer proof.
- Preserve Miles as the conversion and repeat-visit mechanism.
- Work well on 320–430px viewports, slow mobile networks and limited data
  plans.

### 2.2 Non-goals for Phase A

- Anonymous star ratings or anonymous reviews.
- Public free-text reviews, comments, replies or creator profiles.
- Public photo captions in Phase A.
- Paying Miles, cash or discounts in exchange for a positive opinion.
- Inferring “favourite” from raw sales volume.
- Public price comparison without canonical, current, like-for-like data.
- An Amazon-style product catalogue or stock/inventory system.
- Automatic merchant discounts or offers.
- Paid or sponsored ranking without an explicit label.
- Third-party Instagram or TikTok embeds.
- Social account linking, post verification or full social-content moderation.
- Branch-level claims when the earning event does not identify a branch.

### 2.3 Launch hypothesis

If Akiba shows decision-useful customer proof backed by verified earning
events, then more discovery sessions will result in a first verified purchase
at a merchant. Miles will then improve the probability of a second purchase.

The primary metric is:

> **Attributed first verified merchant purchase rate:** the percentage of
> eligible signed-in discovery sessions that produce the member's first
> verified earning event at the selected merchant within seven days.

The primary retention metric is the percentage of those acquired members who
produce a second verified earning event at that merchant within 30 days.

---

## 3. Product truths and terminology

### 3.1 Evidence classes

Akiba must not collapse different evidence into one vague “popular” claim.

| Evidence | Meaning | Allowed public language |
|---|---|---|
| Authoritative earning event | Miles credit committed for a merchant transaction or qualifying scan | “Verified Akiba customer” |
| Verified physical scan with branch context | Committed earning event that explicitly identifies a physical branch visit | “Verified visit” |
| Purchase record | Completed, non-disputed purchase | “Purchased by verified customers” |
| Repeat purchase | Same eligible member purchased again in the defined window | “Popular with returning customers” |
| Explicit recommendation | Eligible member answered yes to the recommendation question | “Would recommend” |
| Explicit product selection | Eligible member selected a product as the item they would recommend | “Customer favourite” or “Members recommend” |
| Experience-tag selection | Eligible member selected a centrally defined reason the place suited the visit | “Great for working”, “Friendly staff” or another qualified tag |
| Authoritative paid amount + declared party size | The earning event includes a currency and paid amount, and the member states how many people the purchase covered | “Typical amount paid per person” |
| Approved first-party photo | Eligible member submitted the photo against the verified visit and it passed processing and moderation | “Photos from verified Akiba customers” |
| Purchase volume | Product appears most often in eligible completed transactions | “Popular” or “Most purchased” |

“Visited” is forbidden for online purchases and for earning events without
physical branch evidence. “Favourite” is forbidden unless it came from an
explicit member selection.

### 3.2 Definitions

- **Verified earning event:** an idempotent event emitted only after Miles are
  authoritatively credited. Current sources are `merchant_scan` and
  `merchant_purchase`.
- **Eligible member:** the authenticated Hub user named by a verified earning
  event that has not been reversed, disputed or invalidated.
- **Contribution request:** the time-limited opportunity created from an
  eligible earning event.
- **Contribution:** structured answers submitted against one contribution
  request.
- **Visit card:** the member-facing composition created from a contribution's
  recommendation, party size, items, experience tags and optional photos. It
  is interaction language, not a public member profile or addressable post.
- **Verified in-store event:** an active verified earning event whose source
  contract proves an in-person merchant transaction. A scan qualifies; another
  purchase source qualifies only when its channel is authoritatively `in_store`.
- **Discovery item:** a system-curated product or service identity created from
  eligible customer purchase contributions at one merchant. It is not an
  inventory, checkout or merchant-authored catalogue record.
- **Public proof:** a thresholded aggregate safe to render on a public page.
- **Public verified recommendation:** an anonymous positive recommendation
  card backed by one active verified earning event. It is an individual
  provenance-labelled card, not an aggregate statistic or popularity claim.
- **Party size:** the number of people whose purchase was covered by the
  verified earning event, not merely the number of people physically present.
- **Typical amount paid per person:** a thresholded spend band calculated from
  authoritative paid amounts divided by eligible declared party sizes. It is
  never reverse-engineered from Miles.
- **Verified customer:** a unique eligible member with at least one active
  verified earning event at the merchant.
- **Discovery session:** a non-PII identifier used to connect page exposure,
  high-intent actions and later authenticated conversion.

---

## 4. Product principles

1. **Discovery creates the first purchase; Miles support the next one.**
2. **Proof before promotion.** Customer-derived evidence appears before the
   full voucher rail.
3. **Truth before richness.** Missing evidence disappears; it is never guessed.
4. **One claim, one source.** Every public label maps to a defined aggregate.
5. **Verified does not mean positive.** Verification proves eligibility to
   contribute, not satisfaction.
6. **No reward for the opinion.** Miles are earned independently of whether a
   contribution is submitted or positive.
7. **Progressive contribution.** Ask one essential question first and stop
   early when the member chooses to stop.
8. **Build a visit card, not a quiz.** The member sees one playful composition
   grow as they add party context, recommendations, tags and optional photos.
9. **Public proof is anonymous and thresholded.** No structured Phase A answer
   exposes a member name, avatar, handle or individual purchase. A positive
   verified recommendation card may appear from one eligible contribution,
   but it contains only centrally defined public labels and makes no aggregate
   claim.
10. **Mobile is the baseline.** Desktop enhances the same information
   architecture; it does not define it.
11. **Low-data by design.** No autoplay, embedded players or third-party social
    scripts. Media is responsive, compressed and lazy below the fold.
12. **Merchants cannot edit customer truth.** They may opt into or out of the
    complete public proof module and report mapping errors, but cannot select
    individual answers or hide one unfavourable metric while keeping another.
13. **The page works while data is sparse.** Each module has a truthful fallback
    or disappears completely.

---

## 5. Mobile-first experience contract

### 5.1 Supported widths and responsive model

The unprefixed Tailwind layout is the complete phone experience. Breakpoint
utilities progressively enhance it.

Required test widths:

- 320px small phone;
- 375px primary mobile baseline;
- 414px large phone;
- 768px tablet portrait;
- 1024px tablet landscape/small laptop;
- 1280px desktop.

Page rules:

- 16px horizontal gutters on phones, increasing at existing `sm` and `lg`
  breakpoints;
- no document-level horizontal overflow at any supported width;
- minimum 44×44 CSS-pixel target for every interactive control;
- at least 8px between adjacent targets;
- body text is 16px where sustained reading is required;
- short metadata may use 12–14px only when contrast and zoom behaviour remain
  acceptable;
- the fixed bottom navigation and every bottom sheet include
  `env(safe-area-inset-bottom)`;
- focus order follows visual order;
- swipeable rails have a visible next-item cue and a non-swipe alternative;
- hover is enhancement only; active and focus-visible states are required;
- all motion respects `prefers-reduced-motion`;
- browser zoom remains enabled.

### 5.2 Mobile content density

- Show at most six items in an initial section.
- Show at most four discovery sections before the page's utility/footer area.
- Use no more than two horizontal rails on the initial phone page.
- Use vertical cards or a two-column compact grid for product favourites so the
  page does not become a stack of sideways carousels.
- Clamp merchant names to two lines on phone cards; never truncate the only
  public proof label.
- Reserve media space with `aspect-ratio` so loading never shifts card text or
  tap targets.

### 5.3 Media and mobile-data budget

- Use `next/image` for first-party merchant, item and social thumbnails.
- Serve AVIF or WebP where supported and provide accurate `sizes`.
- The first in-viewport evidence image may load eagerly; every below-fold image
  loads lazily.
- Merchant and product card media uses a reserved 4:3 or 1:1 aspect ratio.
- Approved first-party photos use generated phone-sized derivatives; the
  browser never downloads the private source upload.
- No Phase A video is downloaded.
- Phase B social cards render a stored thumbnail and outbound link only.
- No third-party embed SDK or player script may ship on `/` or
  `/merchants/[slug]`.
- Rich discovery must preserve p75 mobile Core Web Vitals targets of LCP under
  2.5s, INP under 200ms and CLS under 0.1.

### 5.4 Failure and loading behaviour

- The masthead, search and intents render without waiting for below-fold proof.
- Slow discovery sections use dimensionally stable skeletons.
- Each section fails independently.
- A failed personalized or proof section does not remove search, intents,
  generic merchant discovery or location controls.
- Empty and failed are distinct in telemetry even when both result in no public
  section.
- Do not show a user-facing error for one missing optional rail. Show a compact
  retry state only when the main discovery result set is unavailable.

---

## 6. Discovery page (`/`)

### 6.1 Job to be done

The Discovery page answers:

1. What am I looking for?
2. Which place is relevant and practical?
3. What do verified customers recommend there?
4. Why should I choose it through Akiba?

### 6.2 Above-the-fold copy

Default visitor headline:

> **Discover places people actually love.**

Supporting copy:

> See what verified Akiba customers recommend, then earn Miles when you visit
> or buy.

Signed-in members retain the compact greeting and Miles balance. The balance
must not become larger than the discovery headline.

Search label remains available to assistive technology. Visible placeholder:

> Search food, products or places…

The city/location context is visible as a compact control near search when
known. Unknown location never triggers a permission prompt on load.

### 6.3 Mobile information architecture

Conditional sections disappear without leaving headings or gaps. The phone
order is:

1. greeting/balance when signed in;
2. discovery headline and intent search;
3. active city/location context;
4. intent shortcuts;
5. at most one pending contribution nudge for a signed-in member;
6. personalized verified discovery when genuinely personalized;
7. nearby or city-relevant verified discovery;
8. product recommendations;
9. first-party customer-photo discovery when qualified;
10. customer showcase when Phase B qualifies;
11. offers worth trying;
12. new merchants/exploration inventory.

The default signed-out and cold-start sequence is:

```text
Masthead + search
Intent shortcuts
Compact location/city opt-in
Popular with Akiba members
What people recommend
Offers worth trying
New on Akiba
```

### 6.4 Section contracts

#### Popular with Akiba members

- Based on unique eligible members, not raw transaction count.
- Uses a rolling 30-day window.
- Requires at least 10 unique eligible members per merchant in the window.
- Ranking uses confidence-adjusted recommendation and repeat signals, recency
  and exploration controls; raw volume alone must not decide order.
- Public cards may say “Popular with Akiba members”; they do not expose an exact
  count below the public-count threshold.

#### What people recommend

- Organised around `DiscoveryItemSummary`, not a general merchant card.
- Requires at least five unique explicit item recommendations in a rolling
  90-day window.
- Copy uses “Members recommend” or “Customer favourite”.
- Purchase count alone may produce “Popular”, never “Customer favourite”.
- Every item card names its merchant and opens that merchant page anchored to
  `#member-favourites`.

#### Great for

- Uses centrally curated experience tags selected during eligible visit-card
  contributions; merchants cannot author or rank the tags.
- A tag requires at least five unique eligible contributors in 90 days and at
  least 20% of eligible tag respondents for that merchant.
- Show at most three tags per merchant. Rank by confidence-adjusted unique
  contributors with recency decay, not raw event count.
- Discovery cards use at most one top tag, such as “Great for working”. The
  merchant page may show the three strongest qualified tags.
- Friendly-staff and service tags describe customer sentiment, not an Akiba
  guarantee about every visit.

#### Typical spend

- Render only when the source event carries an authoritative paid amount and
  currency and the member supplied an eligible party size.
- Never derive money from the number of Miles earned. Earn rates, bonuses,
  vouchers, caps and promotions make that conversion unreliable.
- Show a robust median-centred band, for example “Typically KSh 600–900 per
  person”, from at least 10 unique contributors in 90 days.
- Label the measure as amount paid, not menu price. If Akiba later wants a
  pre-discount budget, the event contract must separately supply an
  authoritative gross amount.
- Exclude refunds, reversals, disputes, mixed currencies, unknown party sizes
  and the open-ended `6+` party-size answer from the calculation.

#### Customer photos

- First-party photos belong to Phase A verified recommendations, not the
  Phase B external-social flow.
- A photo is eligible only when submitted by the member attached to a verified
  in-store event and after it passes media processing and moderation.
- Discovery may use one approved photo as merchant-card media immediately
  after approval. Its verified label describes visit eligibility and
  provenance, not an endorsement of everything depicted.
- No customer name, avatar, handle or caption is displayed.
- The gallery and any photo-led discovery section may render with one approved
  photo; there is no minimum review or unique-contributor count for photos.

#### Nearby

- Appears only after a user action grants location or a city is selected.
- Coordinates are ephemeral request inputs and are never placed in analytics,
  profiles or long-lived logs.
- Distance is a context reason, not proof of quality.
- If location is denied or unavailable, offer city selection without repeated
  permission prompts.

#### Offers worth trying

- Appears after customer proof except when an active voucher is genuinely
  urgent for the signed-in member.
- The section may combine current value with proof, but a voucher never becomes
  a popularity claim.
- “Earn Miles here” is shown only when a current authoritative earning contract
  supports that statement.

#### New on Akiba

- Preserves discovery opportunity for merchants without enough history.
- Uses publication time only.
- Must not imply recommendation, popularity or trend.

#### Customer showcase — Phase B

- Renders only when at least three approved, active, consented posts are
  available for the section's scope.
- Uses light thumbnail cards that link out.
- Never embeds a third-party player.

### 6.5 Card system

The page uses three visually related but semantically distinct cards.

#### `MerchantDecisionCard`

Required:

- approved customer photo, merchant image or logo fallback, and merchant name;
- category or matched intent;
- one utility/context line such as city or distance;
- one customer-proof statement when qualified;
- one Akiba value statement when truthful;
- one accessible link target covering the card.

Example:

```text
Arabica Coffee House
Coffee · Nairobi

Known for: Spanish Latte
Great for working · Verified Akiba customers

Earn Miles here                                      →
```

The card shows at most:

- one context reason;
- one customer-proof statement; and
- one reward/value statement.

These are separate typed fields. The existing `MatchReason` collection must
not become a mixed bag in which a voucher happens to suppress customer proof.

#### `DiscoveryItemCard`

Required:

- item image or stable fallback;
- item name;
- merchant name;
- truthful proof label;
- optional category or location context;
- merchant-page destination.

#### `SocialShowcaseCard` — Phase B

Required:

- approved thumbnail;
- platform and public handle;
- merchant name;
- “Verified Akiba customer” label only while the linked account, post and
  earning evidence remain valid;
- explicit outbound-link affordance.

### 6.6 Public response model

Extend the home response without exposing raw contributors:

```ts
type DiscoveryContextReason =
  | { kind: "intent"; label: string }
  | { kind: "distance"; distanceKm: number }
  | { kind: "availability"; label: string }
  | { kind: "affinity"; label: string };

type DiscoveryProof =
  | {
      kind: "recommendation_rate";
      ratePercent: number;
      sampleBand: "10+" | "25+" | "50+" | "100+";
      windowDays: 90;
    }
  | {
      kind: "customer_favourite";
      itemId: string;
      itemName: string;
      sampleBand: "5+" | "10+" | "25+" | "50+";
      windowDays: 90;
    }
  | {
      kind: "returning_customers";
      sampleBand: "10+" | "25+" | "50+" | "100+";
      windowDays: 90;
    }
  | {
      kind: "verified_popularity";
      sampleBand: "10+" | "25+" | "50+" | "100+";
      windowDays: 30;
    }
  | {
      kind: "experience_tag";
      tagId: string;
      label: string;
      sampleBand: "5+" | "10+" | "25+" | "50+";
      windowDays: 90;
    }
  | {
      kind: "typical_paid_per_person";
      currency: string;
      lowerMinor: number;
      upperMinor: number;
      sampleBand: "10+" | "25+" | "50+" | "100+";
      windowDays: 90;
    };

type DiscoveryRewardValue =
  | { kind: "earn"; label: string; deterministic: boolean }
  | { kind: "voucher"; label: string; templateId: string }
  | { kind: "affordable_voucher"; templateId: string };

type DiscoveryItemSummary = {
  id: string;
  merchantId: string;
  merchantSlug: string;
  merchantName: string;
  name: string;
  imageUrl: string | null;
  category: string | null;
  proof: Extract<DiscoveryProof, { kind: "customer_favourite" }>;
};

type ApprovedCustomerPhoto = {
  id: string;
  merchantId: string;
  itemId: string | null;
  thumbnailUrl: string;
  displayUrl: string;
  width: number;
  height: number;
  alt: string;
};
```

Exact contributor counts are not part of the public contract. Banded sample
sizes communicate confidence while reducing privacy and inference risk.

### 6.7 Ranking and exposure fairness

Eligibility is evaluated before scoring:

```text
published merchant
AND active merchant
AND country/city eligible for the request
AND discovery module enabled
AND proof meets its minimum unique-member threshold
AND proof snapshot is current
```

Ranking principles:

- use unique members, not events, as the dominant volume unit;
- deduplicate multiple earning events from the same member at the same merchant
  on the same calendar day for popularity purposes;
- confidence-adjust rates so a perfect result from a tiny cohort does not beat
  a strong result from a credible cohort;
- apply time decay;
- separate “trending” from “popular”;
- reserve an exploration share for new and under-exposed eligible merchants;
- monitor exposure concentration by merchant and merchant group;
- do not permit payment to alter organic order in V1;
- any future sponsored placement must be visually and semantically labelled.

Default exploration share is 20% of generic merchant slots. It is a ranking
configuration value, not a hard-coded component constant.

---

## 7. Merchant decision page (`/merchants/[slug]`)

### 7.1 Job to be done

The merchant page answers:

1. Is this the place for my current need?
2. What do verified customers recommend?
3. What is the experience like?
4. What practical action should I take now?
5. What Akiba value do I receive?

### 7.2 Mobile information architecture

The default phone order is:

1. back navigation;
2. reserved-ratio merchant hero and identity;
3. one dominant action plus secondary actions;
4. verified customer snapshot;
5. “Great for” experience tags and typical spend when qualified;
6. member favourites;
7. a provenance-labelled photo surface with `Verified visits` and `From the
   business` tabs; the verified tab remains approval-gated;
8. customer showcase when Phase B qualifies;
9. Miles and available offers;
10. branches/hours/contact details;
11. merchant description and secondary information not already shown.

If practical branch information is necessary to fulfil the dominant action,
the nearest/primary branch summary remains beside that action and the complete
branch list stays below.

### 7.3 Action hierarchy

The current page exposes several similarly weighted quick-action pills. V1
uses one dominant action based on operating model:

- physical: `Get directions`;
- online: `Visit website` or the configured order destination;
- hybrid: use the merchant-configured primary action, falling back to
  `Get directions` when a physical primary branch exists.

Phone treatment:

- dominant action is a filled, minimum-48px-high button;
- `Save` and one high-value secondary action remain visible;
- lower-frequency contact/social actions move to an accessible `More` sheet;
- the sheet has a title, close control, Escape support, focus management and
  safe-area padding;
- no sticky bottom CTA may collide with the global bottom navigation.

### 7.4 Verified customer snapshot

The snapshot is a compact, readable block, not a dashboard.

It may show at most three qualified signals:

- recommendation rate with sample band;
- returning-customer signal;
- verified-popularity signal;
- strongest explicit customer favourite.
- strongest qualified experience tag.

Example:

```text
Verified by Akiba customers

84% would recommend        25+ responses
Popular with returning customers
Known for the Spanish Latte

[ How verification works ]
```

“How verification works” opens a small explanatory sheet. It must state that
Akiba verifies eligibility through an earning event, not that Akiba verifies
every statement a customer might make.

### 7.5 Visit fit and typical spend

This block helps a prospective customer decide whether the place suits the
occasion before browsing individual favourites.

- Show up to three qualified experience tags, ordered by the §6.4 ranking
  rule; examples include `Great for working`, `Good for meeting friends` and
  `Friendly staff`.
- Show one thresholded typical-paid-per-person band when qualified.
- Copy explains that tags and spend come from verified Akiba customer visits.
- Do not expose party-size distributions or exact contributor counts publicly.
- If only one signal qualifies, render it as compact supporting proof rather
  than an empty-looking standalone section.

### 7.6 Member favourites

- Section id is `member-favourites` for deep linking.
- Render only discovery items that meet the public threshold.
- Sort by confidence-adjusted explicit recommendations, not merchant order.
- Display a maximum of six initially and provide `See all` when more qualify.
- Do not show product price in V1. Customer-generated discovery items are not a
  merchant catalogue, inventory record or current price source.

### 7.7 Photo sources and gallery tabs

The `photos` section uses two explicit tabs so commercial media is never
mistaken for customer evidence:

1. **`Verified visits`** — anonymous positive recommendation cards and approved
   photos submitted after an eligible, verified post-purchase or in-store
   earning event;
2. **`From the business`** — business, location and product images supplied
   by the merchant through Akiba-Platform.

The tab bar renders when either source has public content. Both tabs
remain available so provenance is discoverable. When only one source has
content, it is selected by default and the other tab shows a concise empty
state without exposing suppressed counts. Merchant media must never use a
`verified`, `customer favourite` or equivalent evidence label.

For `Verified visits`:

- render one anonymous recommendation card immediately for each submitted,
  active contribution whose member explicitly answered yes;
- a recommendation card contains only `Would recommend` plus selected
  template-owned `publicLabel` values; it contains no member identity, free
  text, negative feedback, purchase value, timestamp or raw item label;
- negative and skipped recommendation answers remain private and contribute
  only to separately thresholded aggregates;
- render each photo as soon as it is approved and remains active; one approved
  photo is sufficient and no aggregate review threshold applies;
- a photo may carry a qualified item label such as `Spanish Latte`; it never
  displays a contributor identity, caption, purchase amount or visit time;
- item attachment becomes public only after the discovery item itself
  qualifies. Until then, the photo remains merchant-level imagery inside the
  verified source tab;
- `Verified visits` means submission eligibility was verified. It does not
  mean Akiba independently verified every depicted fact.

For `From the business`:

- include merchant-authored business/location images and product images;
- label product names only from the merchant-owned catalogue/read model;
- do not treat presence, ordering or quantity as a recommendation or ranking
  input;
- keep merchant media out of customer-photo qualification, unique-contributor
  thresholds and all verified proof calculations.

Both tabs use a two-column phone grid with reserved aspect ratios, then an
accessible full-screen viewer. The viewer supports Close, Previous and Next
controls, Escape and arrow keys, visible focus and focus return; swiping is an
optional enhancement. Initially render at most six photos. `See all` opens the
remaining loaded set or a paginated gallery.

### 7.8 Participation and merchant controls

Merchant settings are all-or-nothing per public customer-proof category:

- structured customer proof on/off;
- first-party customer photos on/off;
- customer showcase on/off;
- contribution requests on/off.

A merchant may:

- choose its primary action;
- add, caption, order, replace and remove its own business and product media;
- report an incorrect, duplicate or inappropriate customer-generated item;
- report a customer photo for policy, privacy or relevance review;
- disable an entire public customer-proof category;
- request review of suspected fraud or abuse.

A merchant is not required to create or maintain products for this feature.
Discovery items originate from eligible customer purchase contributions and
are normalised by Akiba. Merchant reports are corrections, not editorial
control over which customer favourites qualify.

A merchant may not:

- edit a member's response;
- identify a contributor from aggregate insights;
- hide only an unfavourable metric while retaining favourable customer proof;
- approve, reject, reorder or cherry-pick individual customer photos;
- present merchant-authored media as customer-created, customer-recommended or
  verified post-purchase content;
- label any item as a customer favourite before it meets the verified
  contribution threshold;
- pay for organic ranking.

---

## 8. Post-earn contribution flow

### 8.1 Trigger contract

A recommendation contribution request is created only after an authoritative,
committed `MilesCreditedEvent` proves an in-store earning event. This rule
applies to the complete flow, including recommendation, party size, items,
experience tags and photos; none can be submitted as an unverified public
recommendation through another entry point.

Eligible source contracts:

- `merchant_scan`, because the merchant-present scan proves physical presence;
- `merchant_purchase` only when the producer authoritatively supplies
  `channel: "in_store"`.

An online order, generic manual credit or purchase event with an unknown
channel does not qualify. The user may still browse Discovery, but cannot use
that event to create a verified visit card. Branch-level aggregation is allowed
only when the event also carries an authoritative `branchId`.

The request-creation call is independent of earned-Miles notification
preferences and rollout gates. Disabling push notifications must not change
whether a verified earning event exists. Conversely, a contribution failure
must never fail or roll back the Miles credit.

Both producers call an idempotent function after credit commitment:

```ts
recordVerifiedEarningForDiscovery(event: MilesCreditedEvent): Promise<void>
```

The function persists `eventId` uniquely. It creates an eligible request only
when the event is in-store and merchant settings, member state and fatigue
rules allow it. `paidAmountMinor` and `currency`, when present, are immutable
source evidence. They never come from the client.

### 8.2 Prompt timing and fatigue rules

Preferred prompt surfaces, in order:

1. Hub order success/earned confirmation when the member is already active;
2. a single compact pending-contribution nudge on the next Hub home visit;
3. the in-app notification feed alongside the earned-Miles entry.

The merchant profile's `Verified visits` tab also exposes a persistent,
user-initiated `Add your visit` entry point. It resolves only an existing open,
unexpired request for that member and merchant. When request ingestion was
missed, the resolver may reconcile a recent authoritative AkibaMiles
`miles_ledger` credit into `verified_earning_events`. Current scan awards are
`purchase` credits and must resolve to a matching rewarded, positive-net,
non-reversed `purchase_events` row whose authoritative channel is `in_store`;
legacy `merchant` scan credits remain supported. The resolver then invokes the
same guarded request-creation function used by live ingestion. It does not
permit a generic review or bypass merchant settings, expiry, cooldown, fatigue
or concurrency controls. When no qualifying issuance exists, Hub explains that
an in-store Akiba purchase is required. A broader Discovery-level entry point
is deferred.

Immediately after submission, the signed-in member sees a private
`Your verified visit` confirmation in this tab, including their own photo
processing status. It is explicitly labelled `Only visible to you` and is
loaded through an authenticated member-scoped query. The public merchant
projection independently exposes only eligible positive recommendation cards
with template-owned labels and approved photo derivatives; all other
individual answers remain private.

The transactional earned-Miles push remains a confirmation, not a disguised
survey. A separate contribution push is outside V1 unless a dedicated
engagement preference and frequency policy are approved.

Default fatigue policy:

- request expires 14 days after the earning event;
- maximum one open request per merchant per member;
- 14-day request cooldown per member/merchant;
- maximum two contribution prompts per member in a rolling seven days;
- dismissal ends that request and does not affect Miles;
- members can always choose `Not now` without a confirmation dialog.

All values are server configuration, not client constants.

### 8.3 Mobile flow

The flow is a dedicated mobile route or accessible bottom sheet when already
inside a success surface. It is not a long modal form. The visual metaphor is
a warm, compact visit card: each answer adds a visible line, chip or image to
the same composition. Use direct manipulation, brief confirmation and optional
delight rather than numbered survey chrome.

#### Miles moment and invitation

```text
You earned 120 Miles at Arabica.

Add your visit to the Akiba guide.
Show people what to try and what Arabica is great for.

[ Add my visit ]
[ Not now ]
```

The Miles confirmation is visually complete before the optional request. Copy
states `Optional · Your Miles are already yours`. The structured activity
targets under 30 seconds; adding photos may take longer and is clearly
optional.

#### Card moment: recommend the place

> Would you send a friend to Arabica?

Answers:

- `Yes, I would`;
- `Not this time`;
- `Skip`.

One answer is selected with large expressive cards. No value is preselected.
The card updates immediately, but selection is reversible until submission.

If the answer is `Not this time`, ask one optional private reason:

- product quality;
- service;
- value;
- availability;
- convenience;
- something else.

These reasons are aggregate merchant insight only. They are never public
reviews in V1. After saving the optional private reason, the member can finish
without being asked for positive tags or public photos.

#### Card moment: who the purchase covered

Shown after a positive or skipped place recommendation.

> Who did this purchase cover?

Helper: `Count the people whose food or items were on this bill.`

Choices are `Just me`, `2`, `3`, `4`, `5` and `6+`. This wording prevents a
companion who paid separately from incorrectly affecting per-person spend.
Party size is optional and has no default. The `6+` answer contributes to
private group-context insight but is excluded from public per-person spend
calculation because its denominator is not exact.

#### Card moment: what they tried

> What did you get?

- If the event carries trustworthy line-item name snapshots, present them for
  confirmation rather than silently accepting them.
- Also provide an accessible combobox of qualified canonical items prior
  eligible customers named for this merchant; never expose under-threshold
  candidate names as suggestions.
- Let the member add a short item name when no suggestion matches.
- Allow up to four purchased-item mentions, with `I don't remember` and `Skip`
  paths. Merchant product setup is never required.
- Show the confirmed items on the visit card as removable chips.

Each typed label becomes a private verified item mention. Akiba normalises,
merges and qualifies repeated mentions before any canonical item becomes
public. This is constrained product-name input, not a public free-text review.

When at least one item is present and the place recommendation is positive,
ask:

> Which would you tell someone to try?

Allow up to three selections from the items the member just confirmed. This
separates `purchased` from `explicitly recommended`; choosing nothing is valid.

#### Card moment: what made the visit work

Shown for a positive place recommendation when the category template defines
experience tags.

> What is Arabica great for?

Example chips for a café:

- working or co-working;
- friendly staff;
- meeting friends;
- good Wi-Fi;
- quick stop;
- relaxed atmosphere.

Show no more than eight relevant chips and allow up to three selections. Tags
are centrally curated and versioned. Merchants cannot add leading claims, and
the UI does not identify which selection is currently “winning”.

#### Review and submit

The final visit card previews the structured recommendation and experience
tags. For a positive answer, only `Would recommend` and template-owned public
experience labels may appear on the anonymous public visit card. Party context,
raw/recommended item text and private negative reasons do not appear on that
individual card and remain inputs to separately governed aggregates.

Primary CTA: `Add to the Akiba guide`. Secondary action: `Edit`. The CTA is
not `Post`, because the output is an anonymous structured recommendation—not
a named social post, caption or free-form review. A successful CTA persists
the structured contribution before the photo step is offered.

#### Card moment: optional photos

After structured submission succeeds, offer:

> Add a photo to help people picture the place.

The member may choose camera or photo library and add up to three still images.
No caption is collected in V1. Before selection, concise guidance says:
`Avoid faces, children, receipts and personal information.` The user may skip
without losing the saved contribution.

For each image:

- show local preview, upload progress, retry and remove;
- allow an optional attachment to one of the member's selected items;
- preserve the structured submission when an upload fails or the app closes;
- state that photo publication requires Akiba moderation;
- never promise that an individual image will be displayed.

#### Success and impact reveal

```text
Visit added. Thanks for helping people discover Arabica.

Your anonymous recommendation now appears in Verified visits. Broader public
insights still require enough customers to agree.

[ View Arabica ]
[ Done ]
```

Promise immediate public display only for an eligible positive structured
recommendation. It disappears after reversal, withdrawal, integrity
suppression or merchant opt-out. Aggregate insights remain thresholded.

### 8.4 Interaction requirements

- One focused choice per phone viewport; the persistent visit-card preview may
  collapse to a one-line summary on 320px devices.
- The dedicated route uses `min-height: 100dvh`, not a fixed `100vh`, so mobile
  browser chrome does not hide content.
- Show a compact named-stage indicator for the structured flow, for example
  `Your picks · 2 of 3`. Use `Your visit`, `Your picks` and `Great for` rather
  than `Question 2`; announce the same state to assistive technology. Photos
  are presented afterward as an optional add-on, not a required fourth step.
- Back preserves prior answers.
- Close and `Not now` are always reachable.
- Submission button disables while pending and announces success or inline
  error.
- A retry reuses the same idempotency key.
- Keyboard focus moves to the new question heading after navigation.
- Largest supported text size does not clip answers or the close control.
- The software keyboard never covers the search result or submit action.
- Product-name comboboxes have persistent labels, cap input at 80 characters,
  support keyboard/screen-reader selection and never rely on placeholders as
  labels.
- Tag and item limits are announced before the user reaches them; selection
  does not cause layout-shifting error banners.
- Camera and library permissions are requested only after the member chooses
  the corresponding action.
- A sticky primary CTA reserves scroll padding and
  `env(safe-area-inset-bottom)` so it never covers the last choice, inline
  error or focused control.
- Use existing semantic colour, type, spacing and motion tokens; verify text,
  chip state, focus and disabled contrast independently in light and dark mode.
- Delight uses opacity and transform only, lasts no more than 250ms and is
  removed under `prefers-reduced-motion`.
- No gesture-only dismissal is required.

### 8.5 Contribution lifecycle

- Members may withdraw a submitted structured contribution at any time from
  their activity/privacy controls.
- Withdrawal excludes it from the next aggregate refresh.
- Raw contributions are not publicly addressable.
- A reversed or disputed earning event makes the contribution ineligible and
  removes it from aggregates.
- Reinstatement requires an authoritative reinstatement event.
- Contribution edits are allowed while the request is unexpired; every update
  is versioned for audit without exposing old answers to merchants.
- Photo consent and status are independently revocable. Withdrawing a
  contribution withdraws its photos; deleting one photo does not require
  deleting the structured contribution.

### 8.6 Worked journey: latte and croissant at Arabica

1. The member completes an in-store earning event at Arabica. The Miles success
   state finishes, then offers `Add my visit`.
2. They answer `Yes, I would` to sending a friend there.
3. They choose the number of people this purchase covered. If the event also
   carries an authoritative paid amount, this answer can later contribute to a
   thresholded spend band; the Miles count is never used as money.
4. They add `Caffè latte` and `Croissant`, then select either or both under
   `Which would you tell someone to try?`.
5. They choose up to three café tags such as `Friendly staff`, `Great for
   working` and `Good for meeting friends`.
6. The visit-card preview shows their picks and tags. `Add to the Akiba guide`
   saves the structured contribution.
7. They optionally add up to three photos. Each uploads privately, loses its
   location metadata, receives safe derivatives and waits for moderation.
8. Nothing appears publicly as an individual review. Over time, independent
   eligible contributions may qualify the items, the strongest experience tag,
   a typical-paid-per-person band and the merchant photo gallery.

---

## 9. Question templates and product-normalisation ownership

### 9.1 Template model

Question wording and experience tags are centrally versioned:

```ts
type DiscoveryQuestionTemplate = {
  id: string;
  version: number;
  categorySlug: string | null; // null = general fallback
  recommendationPrompt: string;
  negativeReasonOptions: Array<{ id: string; label: string }>;
  partySizePrompt: string;
  itemPrompt: string;
  recommendationItemPrompt: string;
  experiencePrompt: string | null;
  experienceOptions: Array<{
    id: string;
    inputLabel: string;
    publicLabel: string;
  }>;
  maxPurchasedItems: 4;
  maxRecommendedItems: 3;
  maxExperienceOptions: 3;
  photoPrompt: string;
  photoSafetyGuidance: string;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
};
```

Templates are snapshot onto the contribution request so later copy changes do
not change the meaning of historical answers.

### 9.2 Ownership decision

- **Accountable owner:** Product/Research.
- **Responsible editor:** designated Discovery Content owner.
- **Consulted:** Merchant Success for category language, Data for answer
  comparability, Privacy/Compliance for sensitive categories.
- **Engineering owner:** schema, validation, versioning and rollout tooling
  only.

Merchants cannot author arbitrary questions in V1. This prevents leading
questions, incomparable results and accidental collection of sensitive data.

Template review occurs:

- before a new merchant category is enabled;
- whenever answer options change meaning;
- at least quarterly for active category templates.

### 9.3 Customer-generated discovery-item pipeline

Merchants do not set up products for this feature. `merchant_products` is
historically tied to commerce and inventory and is neither a prerequisite nor
the source of truth for verified discovery.

Discovery items are populated by eligible customer purchase contributions:

1. the earning event may supply an untrusted item-name hint;
2. the member confirms that hint, selects an existing customer-generated
   suggestion or enters a short item name;
3. the submission creates a private verified item mention tied to that
   contribution;
4. the normalisation service applies Unicode, whitespace, punctuation and
   case normalisation within the same merchant;
5. exact aliases and high-confidence matches attach to an existing canonical
   item;
6. unmatched labels create an internal candidate, never an immediately public
   product;
7. ambiguous, conflicting or policy-flagged candidates enter an Akiba admin
   review queue;
8. a candidate qualifies as a canonical discovery item after at least three
   unique eligible members independently name or select it in 90 days;
9. the stronger public `Customer favourite` label still requires the five
   explicit recommendations defined in §10.11.

Normalization must not merge similarly named items across merchants. Aliases
such as spelling variants remain internal; the public response emits one
reviewed canonical display name. URLs, handles, contact information and text
that does not plausibly name a product or service are rejected or sent to
review. Raw labels are private and follow an approved retention schedule.

The pipeline has no merchant setup dependency. A merchant can report an
incorrect, duplicate or inappropriate item through Akiba-Platform, but Akiba
owns the merge, suppression and canonical-name decision. Merchant input cannot
create customer-proof evidence.

- **Accountable owner:** Product/Data.
- **Operational owner:** Akiba Discovery Operations through the admin
  dashboard.
- **Merchant-facing report surface:** Akiba-Platform.

---

## 10. Data model

Names are proposed and may be adjusted to repository conventions. The privacy
and idempotency contracts are normative. These are logical ownership
boundaries: Akiba-Platform owns merchant-facing settings and actions; Hub owns
member contributions and public snapshot reads; the systems exchange only
authenticated server-to-server contracts.

### 10.1 `merchant_discovery_settings`

Canonical merchant-facing settings are owned and mutated by Akiba-Platform.
Hub consumes a validated internal representation or synchronized read model.

```text
partner_id                    uuid primary key → partners.id
contributions_enabled         boolean not null default false
structured_proof_enabled      boolean not null default false
customer_photos_enabled       boolean not null default false
social_showcase_enabled       boolean not null default false
primary_action_kind           text null
primary_action_url            text null
updated_by                    uuid/text null
updated_at                    timestamptz not null
```

### 10.2 `merchant_discovery_items`

```text
id                            uuid primary key
partner_id                    uuid not null → partners.id
canonical_name                text not null
normalized_key                text not null
category                      text null
aliases                       text[] not null default '{}'
status                        text not null // candidate | qualified | merged | suppressed
merged_into_item_id           uuid null → merchant_discovery_items.id
first_seen_at                 timestamptz not null
qualified_at                  timestamptz null
created_at                    timestamptz not null
updated_at                    timestamptz not null
```

These rows are created by the customer-generated normalisation pipeline, not by
merchant product setup. Canonical names and aliases are validated,
length-limited and treated as untrusted text. Product cards use merchant media
or a stable category fallback. An approved customer photo may become
item-specific media only when the photo is linked to the item and both the
photo and canonical item independently meet their public rules.

### 10.3 `merchant_discovery_item_mentions`

```text
id                            uuid primary key
request_id                    uuid not null → discovery_contribution_requests.id
client_item_key               text not null
hub_user_id                   uuid not null
partner_id                    uuid not null
raw_label                     text not null
normalized_label              text not null
canonical_item_id             uuid null → merchant_discovery_items.id
source                        text not null // event_confirmation | customer_input | existing_selection
moderation_status             text not null // pending | accepted | flagged | suppressed
created_at                    timestamptz not null
updated_at                    timestamptz not null
```

Raw labels are private contribution data. Only an accepted canonical display
name can enter a public snapshot. `(request_id, client_item_key)` is unique so
one contribution can idempotently name several items.

### 10.4 `verified_earning_events`

```text
id                            uuid primary key
event_id                      text unique not null
hub_user_id                   uuid not null
canonical_id                  text null
partner_id                    uuid not null → partners.id
source                        text not null
channel                       text not null // in_store | online | unknown
occurred_at                   timestamptz not null
purchase_event_id             text null
branch_id                     uuid null
paid_amount_minor             bigint null
currency                      char(3) null
gross_amount_minor            bigint null
source_item_ref               text null
item_name_snapshot            text null
item_category_snapshot        text null
verification_status           text not null // active | reversed | disputed
created_at                    timestamptz not null
updated_at                    timestamptz not null
```

This is append-oriented evidence. Status changes require a durable reversal or
dispute event and an audit record. Amounts and channel are accepted only from
authoritative producers. `gross_amount_minor` is optional and is not used in
V1's typical-paid-per-person metric.

### 10.5 `discovery_contribution_requests`

```text
id                            uuid primary key
earning_event_id              uuid unique not null → verified_earning_events.id
hub_user_id                   uuid not null
partner_id                    uuid not null
template_id                   uuid/text not null
template_version              integer not null
template_snapshot             jsonb not null
state                         text not null // open | submitted | dismissed | expired | ineligible
expires_at                    timestamptz not null
first_prompted_at             timestamptz null
submitted_at                  timestamptz null
dismissed_at                  timestamptz null
created_at                    timestamptz not null
updated_at                    timestamptz not null
```

### 10.6 `merchant_discovery_contributions`

```text
id                            uuid primary key
request_id                    uuid unique not null → discovery_contribution_requests.id
hub_user_id                   uuid not null
partner_id                    uuid not null
would_recommend               boolean null
negative_reason_id            text null
party_size                    smallint null // 1..5; null for skipped or 6+
party_size_is_six_plus        boolean not null default false
experience_option_ids         text[] not null default '{}'
answer_version                integer not null default 1
submitted_at                  timestamptz not null
withdrawn_at                  timestamptz null
updated_at                    timestamptz not null
```

Validation guarantees that the request, contribution and merchant belong to
the same eligible scope. `party_size` and `party_size_is_six_plus` are mutually
exclusive. Experience option ids must exist in the request's template
snapshot.

### 10.7 `merchant_discovery_contribution_items`

```text
contribution_id               uuid not null → merchant_discovery_contributions.id
item_mention_id               uuid not null → merchant_discovery_item_mentions.id
is_recommended                boolean not null default false
created_at                    timestamptz not null
primary key (contribution_id, item_mention_id)
```

This join separates `the customer got it` from `the customer recommends it`.
The server limits a contribution to four rows and at most three recommended
rows. Every mention must belong to the same request, member and merchant.
Canonical-item attachment happens in the normalization pipeline and cannot be
chosen by the client.

### 10.8 `merchant_visit_photos`

```text
id                            uuid primary key
contribution_id               uuid not null → merchant_discovery_contributions.id
hub_user_id                   uuid not null
partner_id                    uuid not null
item_mention_id               uuid null → merchant_discovery_item_mentions.id
private_source_key            text not null
thumbnail_key                 text null
display_key                   text null
width                         integer null
height                        integer null
moderation_status             text not null // uploading | processing | pending | approved | rejected | withdrawn
moderation_reason_code        text null
consent_version               text not null
submitted_at                  timestamptz not null
approved_at                   timestamptz null
withdrawn_at                  timestamptz null
updated_at                    timestamptz not null
```

Source files stay private and are never served publicly. Only generated,
metadata-stripped derivatives of approved images may enter public snapshots.
A contribution has at most three active photo rows. Item linkage is emitted
publicly only after the linked canonical discovery item qualifies.

### 10.9 `merchant_profile_media` read contract

Canonical merchant media is authored and managed by Akiba-Platform. Hub reads
only its public projection, either from the public merchant RPC or a durable
synchronised read model with this shape:

```text
id                            uuid/string stable public identifier
partner_id                    uuid not null → partners.id
kind                          text not null // business | product
product_id                    uuid null // merchant-owned product reference
image_url                     text not null // approved display derivative
thumbnail_url                 text not null // approved grid derivative
title                         text null
alt_text                      text not null
sort_order                    integer not null
publication_status            text not null // draft | published | removed
created_at                    timestamptz not null
updated_at                    timestamptz not null
```

The merchant may control order only within this merchant-authored collection.
URLs must resolve to processed public derivatives, not original uploads. This
contract contains no customer-photo rows and never influences verified proof.
During contract rollout, Hub may derive the same safe projection from existing
public banner and merchant-product image fields; it must not expose price,
inventory or other catalogue-only fields as a side effect.

### 10.10 Aggregate snapshots

Runtime public pages never expose raw contributions. During rollout, the Hub
server may read active positive contributions to build the minimal anonymous
verified-recommendation projection defined above; clients never receive the
raw row or private fields.

Scheduled aggregation produces:

- `merchant_discovery_public_snapshots` — one thresholded public snapshot per
  merchant;
- `merchant_discovery_item_snapshots` — one thresholded public snapshot per
  item;
- `merchant_discovery_photo_snapshots` — approved, active photo ids and safe
  derivatives; each approved photo is independently public-eligible;
- `merchant_discovery_insight_snapshots` — private merchant aggregates and
  confidence metadata.

Snapshots include:

- source window;
- unique-member cohort size internally;
- public sample band;
- numerator/denominator where applicable;
- confidence score;
- generated time;
- ranking version;
- qualified experience tags, typical-spend band and active approved photos;
- suppression reason when not public.

Public APIs receive only already-thresholded aggregate fields plus individually
approved photo derivatives. This prevents a client from reconstructing
suppressed aggregate counts from raw rows.

### 10.11 Default thresholds

Launch defaults are configurable and reviewed with Data and Privacy:

| Signal | Public minimum | Window |
|---|---:|---:|
| Individual verified recommendation card | 1 active submitted positive contribution | Current |
| Merchant recommendation rate | 10 unique contributors | 90 days |
| Canonical discovery-item qualification | 3 unique item mentions | 90 days |
| Customer-favourite item | 5 unique contributors | 90 days |
| Public experience tag | 5 unique contributors and 20% of eligible tag respondents | 90 days |
| Typical amount paid per person | 10 unique contributors with eligible amount and exact party size | 90 days |
| Customer-photo gallery | 1 approved active photo | Current |
| Returning-customer label | 10 unique customers, at least 3 repeat customers | 90 days |
| Verified-popularity section | 10 unique customers | 30 days |
| Trending eligibility | 10 unique customers plus growth against own baseline | 7 days |
| Social showcase section | 3 approved active posts | Current |
| Merchant private insight | 5 unique members | Relevant window |

No exact statistic is emitted below its threshold. Public snapshots use sample
bands rather than exact cohort sizes.

### 10.12 Typical-paid-per-person calculation

The public label is deliberately `typical`, not `average`:

1. include only active in-store events with authoritative
   `paid_amount_minor`, one ISO currency and an exact `party_size` from 1–5;
2. divide the paid amount by the declared number of people the purchase
   covered;
3. retain at most one eligible value per member, merchant and local calendar
   day for this aggregate;
4. calculate the median within each merchant/currency window;
5. map the median to a preconfigured, non-overlapping local-currency band and
   publish only that band after the 10-unique-contributor threshold is met.

Do not perform foreign-exchange conversion or combine currencies. Reversals,
disputes, refunded events, non-positive amounts, `6+` answers and values that
fail configured integrity bounds are excluded with an auditable reason. Scan
events without an authoritative paid amount can support recommendation and
visit proof but do not contribute to spend.

---

## 11. Service and API contracts

### 11.1 Earning ingestion

Current post-credit paths are extended:

- Hub purchases call `recordVerifiedEarningForDiscovery()` after successful
  reward release;
- `POST /api/internal/miles-credited` calls it after authentication,
  validation and authoritative event acceptance;
- a reversal/dispute endpoint or durable internal event updates
  `verification_status`.

Ingestion is idempotent on `eventId`. Contribution persistence failure is
retryable through an outbox and never changes the reward result.

### 11.2 Member contribution endpoints

Proposed contracts:

```text
GET    /api/me/discovery-contributions/next
GET    /api/me/discovery-contributions/:requestId
PUT    /api/me/discovery-contributions/:requestId
POST   /api/me/discovery-contributions/:requestId/dismiss
DELETE /api/me/discovery-contributions/:contributionId
POST   /api/me/discovery-contributions/:contributionId/photos/upload-intent
POST   /api/me/discovery-contributions/:contributionId/photos/:photoId/complete
DELETE /api/me/discovery-contributions/:contributionId/photos/:photoId
```

All routes:

- require a valid Hub session;
- authorize ownership server-side;
- validate active request, expiry and earning eligibility;
- validate item/merchant association;
- rate limit mutation attempts;
- return structured field errors;
- accept an idempotency key for submit/update.

Photo upload uses a short-lived, size-limited signed intent to private object
storage. Completion enqueues processing; it does not make the source object
public. The completion route validates the declared object key against the
authenticated contribution and does not accept an arbitrary storage path.

A Server Action may replace an HTTP mutation where consistent with the app's
architecture, but authentication and validation remain identical.

### 11.3 Public discovery reads

Extend `getHomeFeed()`/`GET /api/home/feed` with independently fetched proof
and item sections. Do not create a second competing public home-feed endpoint.

Merchant detail reads extend the existing public merchant query with:

- `publicDiscoveryProof`;
- `memberFavouriteItems`;
- `publicExperienceTags`;
- `publicTypicalPaidPerPerson`;
- `approvedCustomerPhotos`;
- `merchantMedia`, containing only published merchant-authored business and
  product image projections with explicit provenance;
- `publicSocialShowcase` in Phase B;
- `discoverySettings` limited to fields needed for rendering.

The public merchant RPC remains responsible for aggregate publication
eligibility. During rollout, Hub may project `approvedCustomerPhotos`
server-side from `merchant_visit_photos`, but only rows in the explicit
`approved` state and only their processed derivative keys; it never returns
source objects, contributor identity or unmoderated rows.

### 11.4 Akiba-Platform merchant contracts

The merchant dashboard lives on Akiba-Platform, not in this repository. Hub
must not add a second merchant settings or insights UI.

Akiba-Platform owns:

- merchant authentication and partner-role authorization;
- public-proof participation controls;
- primary-action configuration;
- merchant-facing customer-discovery insights;
- item correction/report submission;
- customer-photo participation controls and report submission;
- merchant business/product media upload, processing, captions, ordering and
  removal;
- offer-opportunity review and the existing offer publication workflow.

Hub exposes or publishes authenticated aggregate contracts for Akiba-Platform
to consume. Merchant owners and managers receive only snapshots for their own
partner id. No contract returns contributor identity, earning-event id,
payment reference, raw product-name entry or individual response rows.

Akiba-Platform exposes merchant settings to Hub through an authenticated
internal API or durable synchronized read model. Failure to fetch an optional
setting fails closed for customer-proof display without taking down ordinary
merchant discovery.

Merchant-media failure is isolated from verified-customer proof and ordinary
profile rendering. Akiba-Platform must not write merchant uploads into
`merchant_visit_photos`; Hub treats `merchantMedia` and
`approvedCustomerPhotos` as separate, whitelisted response fields.

---

## 12. Merchant insights and offer guidance

The canonical merchant-side product, media, calculation, permission and API
contract is defined in
`merchant-discovery-media-and-intelligence-spec.md`. This section remains the
cross-surface summary and must not be implemented as a second dashboard.

### 12.1 V1 insights

The Akiba-Platform merchant dashboard adds a `Customer discovery` section
containing:

- recommendation rate and confidence/sample band;
- selected experience tags and change over time;
- private party-size distribution;
- median paid amount per purchase and eligible typical-paid-per-person band,
  clearly separated and shown only when authoritative amount coverage is
  sufficient;
- most explicitly recommended items;
- most frequently reported purchased items, separately labelled;
- most purchased items only where Akiba-Platform provides authoritative
  line-item data, never inferred from customer wording;
- items associated with first-time customers;
- items associated with returning customers;
- aggregate private reasons for `Not this time`;
- discovery impressions, merchant-page visits, high-intent actions and
  attributed first purchases;
- customer-photo coverage and gallery engagement, without contributor
  identity;
- time trend against the merchant's own prior period.

All insights suppress cohorts below five unique members.

### 12.2 Offer opportunities

Akiba may recommend an offer opportunity; it never creates or publishes an
offer automatically.

Good recommendation inputs include:

- high discovery interest with low verified conversion;
- a first-purchase item with weak 30-day repeat;
- an off-peak period with sufficient historical activity;
- an under-discovered item with strong explicit recommendation;
- a segment that previously responded to a comparable offer.

Akiba must not recommend discounting the most popular item merely because it
is popular. A suggestion names the observed goal, evidence window, confidence
and expected trade-off.

Example:

> **Opportunity: convert weekday interest**
>
> Your page receives weekday lunch interest, but verified purchases are lower
> than your weekend baseline. Consider a time-limited weekday bundle.
>
> Based on 25+ customer journeys over the last 30 days.

The merchant reviews and publishes any resulting offer through the existing
voucher/offer workflow.

---

## 13. Privacy, consent, integrity and moderation

### 13.1 Phase A structured data

- Contribution copy states why the answer is being requested and that results
  may appear only in aggregate.
- Submission is optional and independent of Miles.
- Members can withdraw later.
- No public name, avatar, handle or answer-level page exists.
- A typed product name remains private as an individual answer. Only a
  normalised canonical item that independently reaches the required unique
  member thresholds may become public.
- Merchant views are aggregate only.
- The privacy notice must be reviewed before launch for recommendation,
  aggregation, personalization and merchant-insight purposes.
- Sensitive merchant categories require template review or exclusion.

### 13.2 First-party photo consent and moderation

- Adding a photo requires a concise, explicit notice that Akiba may process,
  moderate and display an approved derivative on the merchant profile and in
  Discovery. The member retains ownership and grants only the reviewed product
  licence needed for those uses.
- Consent is versioned and revocable. Removing a photo withdraws it from the
  next snapshot, CDN cache and public derivatives within the stated removal
  target; the private source follows the approved deletion/appeal retention
  schedule.
- Accept JPEG, PNG, WebP and HEIC still images up to 10 MB. Validate magic
  bytes and decoded content server-side; do not trust filename or MIME type.
- Strip EXIF, GPS and all other metadata. Re-encode safe thumbnail and display
  derivatives as AVIF/WebP, enforce pixel/dimension limits and never serve the
  original upload publicly.
- Images enter `pending` moderation after processing. Automated safety and
  duplicate checks may prioritise review but cannot bypass the approved
  policy. Public eligibility requires `approved` status.
- Guidance asks members to avoid faces, children, receipts, number plates,
  screens and personal information. Identifiable people, sensitive documents,
  unsafe content, advertising, watermarks and irrelevant images are rejected
  or escalated under the moderation policy.
- Akiba Admin Operations owns the queue, policy decisions, audit trail and
  appeals. Merchants can report images through Akiba-Platform but cannot make
  approval decisions.
- No face recognition, identity inference or biometric template is created.

### 13.2a Merchant-provided media

- Merchant uploads use a separate ownership, consent and storage lifecycle
  from verified-customer photos.
- Akiba-Platform verifies the uploader is an authorised owner or manager for
  the partner before accepting a mutation.
- Originals are private; public pages receive processed derivatives with
  decoded-content validation, metadata stripping, dimension limits and safe
  output formats.
- Merchant media is labelled `From the business` everywhere it appears and
  never satisfies a verified-customer threshold.
- Merchants may order and remove their own media, but moderation, legal
  takedown and platform suppression remain available to Akiba Operations.
- Product captions come only from the merchant-owned product record. A photo
  cannot manufacture a customer favourite, popularity or availability claim.

### 13.3 Integrity controls

- Only active authoritative earning events create eligible contributions.
- One contribution per earning event.
- Same-member/same-merchant/day events deduplicate for public popularity.
- Reversals and disputes invalidate evidence.
- Rate limits apply to contribution writes and item search.
- A single new product label never becomes public.
- A photo cannot be submitted without an eligible structured contribution and
  cannot become public before processing and moderation complete.
- Same-image and near-duplicate detection limits gallery spam even though
  approved photos do not require a unique-contributor threshold.
- Candidate product names pass normalization, policy checks and duplicate
  handling before qualification.
- Aggregation detects abnormal merchant/member concentration.
- Merchant staff accounts and known test accounts are excluded from public
  aggregates for their own merchant.
- Admins can suppress a merchant, item or snapshot with an auditable reason.
- Public evidence is recomputed after suppression, withdrawal or reversal.

### 13.4 Phase B social consent

Linking an Akiba identity to a public social handle requires a separate,
explicit and revocable consent category. It is not bundled into Phase A
structured contribution consent.

Unlinking:

- removes associated posts from public surfaces;
- stops revalidation;
- removes cached public handle/thumbnail metadata according to the approved
  retention schedule;
- preserves only the minimum audit/moderation record approved by Privacy.

---

## 14. Phase B — verified social showcase

Phase B is independently gated and must not delay Phase A.

This phase covers links to content published on external social accounts. It
does not include first-party photos uploaded directly into a verified visit
card; those are governed by §§7.7 and 13.2.

### 14.1 User flow

1. eligible contributor chooses `Add a social post`;
2. contributor links the relevant social account with explicit consent;
3. contributor submits an allowlisted post URL;
4. Akiba resolves supported metadata and verifies that the linked account owns
   the post;
5. submission enters the admin moderation queue;
6. approved content becomes eligible for thresholded merchant/showcase
   surfaces;
7. the system periodically revalidates availability and account ownership.

### 14.2 Rules

- A URL alone is not verification.
- Do not award Miles or cash for posts.
- Status recognition may be considered only after disclosure implications are
  reviewed.
- Use outbound thumbnail cards; do not embed players.
- Allowlist platforms and URL shapes.
- Safe outbound links use `noopener noreferrer` and clearly name the platform.
- Deleted, private, ownership-mismatched or consent-withdrawn posts are removed.
- Merchants receive an all-or-nothing showcase toggle, not per-post editorial
  control.
- Akiba owns moderation decisions, takedown handling and appeals.

### 14.3 Launch gates

Phase B requires named owners and approved designs for:

- social account linking and token lifecycle;
- platform/oEmbed terms and metadata retention;
- explicit social-link consent and withdrawal;
- moderation policy, queue, roles and service levels;
- reporting, takedown and appeal;
- revalidation of deleted/private/changed posts;
- legal review for disclosure, defamation, privacy and advertising rules;
- low-data thumbnail delivery.

---

## 15. Analytics and attribution

### 15.1 Required events

```text
discovery_home_view
discovery_search_submit
discovery_intent_tap
discovery_section_view
discovery_card_impression
discovery_card_tap
discovery_proof_explainer_opened
merchant_profile_view
merchant_primary_action_tap
merchant_favourite_item_tap
contribution_prompt_viewed
contribution_started
contribution_question_answered
contribution_party_size_selected
contribution_item_added
contribution_item_recommended
contribution_experience_tag_selected
contribution_submitted
contribution_dismissed
contribution_withdrawn
contribution_photo_upload_started
contribution_photo_upload_completed
contribution_photo_upload_failed
contribution_photo_withdrawn
customer_photo_impression
customer_photo_gallery_opened
verified_purchase_attributed
```

Analytics must not contain:

- raw search text;
- precise coordinates;
- payment references;
- free-form contribution text;
- image contents, object keys or moderation reasons;
- social tokens;
- raw member identity in general product analytics.

### 15.2 Attribution

- Create a non-PII discovery-session id.
- Record section, ranking version, merchant id, position and proof kind for card
  exposure/click.
- Attribute a verified earning event to the most recent eligible high-intent
  action for the same authenticated member and merchant within seven days.
- Use merchant-page view as a weaker fallback only when no high-intent action
  exists.
- Signed-out sessions are measured through high-intent action unless they are
  safely joined to a later authenticated session under the approved identity
  policy.
- Attribution is reporting evidence, not proof of incrementality.

An active production analytics provider is a launch dependency. The current
production no-op tracker cannot evaluate this product hypothesis.

### 15.3 Success and guardrail metrics

Success:

- attributed first verified purchase rate;
- 30-day repeat rate after attributed acquisition;
- discovery-to-merchant-page click-through;
- merchant-page-to-high-intent-action rate;
- proof-card versus generic-card conversion;
- contribution start and completion rates;
- optional photo add rate, upload success and moderation approval rate;
- qualified proof coverage by merchant/category;
- merchant insight adoption and resulting offer creation.

Guardrails:

- exposure concentration by merchant and group;
- contribution dismissal and withdrawal rate;
- negative-response rate changes after prompting;
- abuse/suppression rate;
- photo report, rejection and withdrawal rate;
- public-proof complaint rate;
- page weight and mobile Core Web Vitals;
- search/feed error and empty-state rate;
- no material reduction in Pass access, voucher use or earned-Miles trust.

---

## 16. Architecture and performance

### 16.1 Rendering boundaries

- Keep `/` and `/merchants/[slug]` as Server Components by default.
- Keep search, location, save, contribution controls and interactive sheets as
  small leaf Client Components.
- Fetch independent home sections in parallel.
- Stream below-fold proof, item and offer sections behind stable Suspense
  boundaries when doing so improves first paint without causing layout shift.
- Do not suspend the masthead/search on slow proof aggregation.
- Pass only the fields a Client Component renders across the RSC boundary.
- Social Phase B code loads only when a qualifying social section is present or
  the submission feature is activated.
- First-party gallery code and full-size image variants load only when the
  qualified section approaches the viewport or the viewer opens.

### 16.2 Query strategy

- Public pages read precomputed aggregate snapshots.
- Avoid per-card queries.
- Batch merchant ids when enriching cards.
- Cache public snapshots for a short, explicit period while preserving
  suppression and withdrawal propagation targets.
- Merchant live inventory, current voucher eligibility and save state retain
  their stricter freshness rules.
- Every discovery section has an independent timeout/failure boundary.
- Photo source storage is private; the public image host exposes only approved
  derivative keys present in a current snapshot.

### 16.3 Freshness targets

- new verified earning event recorded: within 5 minutes of committed event
  delivery;
- contribution visible in private member history: immediately after submit;
- public aggregate refresh: within 60 minutes;
- withdrawal/reversal public removal: within 60 minutes;
- admin emergency suppression: within 5 minutes;
- approved photo public appearance: within 60 minutes of approval;
- photo withdrawal public and CDN removal: within 60 minutes;
- Akiba-Platform merchant insight refresh: within 24 hours unless marked
  otherwise.

---

## 17. Security and authorization

- Earning ingestion requires the existing internal shared-secret rotation and
  rate limiting, or a stronger service assertion.
- Never trust merchant id, user id or item id from the client when the server
  can derive them from the request.
- Member routes authorize the contribution request against the authenticated
  `auth.users` id.
- Akiba-Platform merchant routes authorize partner membership and
  owner/manager permissions; Hub does not duplicate merchant authentication.
- Admin suppression and future moderation actions require explicit admin roles
  and immutable audit records.
- RLS denies anonymous/authenticated direct reads of earning events and raw
  contributions.
- Service role owns ingestion and aggregate generation.
- Public access is limited to thresholded snapshot RPCs or server reads.
- URLs, customer-entered product labels and merchant-authored settings are
  length-limited, normalised and escaped.
- Signed photo-upload intents bind contribution id, user id, object prefix,
  content-length ceiling and short expiry. Processing runs in an isolated
  worker with decode time, memory, pixel and file-count limits.
- Only approved derivative buckets/paths may be referenced by a public
  snapshot or server-signed public response; source uploads and pending images
  deny public reads.
- Social URLs are allowlisted and resolved server-side in Phase B.

---

## 18. Rollout plan

### Stage 0 — contracts and observability

- Fix current home-feed schema/RPC drift, including `banner_url` availability.
- Activate a production analytics provider.
- Add feature flags and merchant discovery settings.
- Add verified earning-event persistence and reversal contract.
- Confirm category and country eligibility rules.

### Stage 1 — closed structured-data pilot

- Add the customer-generated discovery-item normalization pipeline.
- Create contribution requests from verified earning events.
- Launch the post-earn flow to a small member cohort.
- Keep all resulting proof private.
- Validate completion, item deduplication, party-size comprehension, tag
  quality, reversals and aggregate correctness.

### Stage 2 — first-party photo safety pilot

- Enable optional uploads only for the closed cohort after structured answers
  save reliably.
- Validate private storage, metadata stripping, transcoding, moderation,
  withdrawal and cache removal end to end.
- Keep all photos private until Admin Operations and Privacy approve the queue,
  policy and service levels.

### Stage 3 — qualified public proof

- Generate public snapshots.
- Add verified proof, experience tags, spend bands, member favourites and
  qualified customer-photo galleries to selected merchant pages.
- Add the provenance-labelled `Verified visits` / `From the business` photo
  tabs; merchant media may solve cold start but remains outside proof ranking.
- Add one proof-led home section.
- Run shadow ranking before changing default order.
- Measure conversion and exposure concentration.

### Stage 4 — acquisition-led Discovery page

- Ship the new masthead promise and final section order.
- Add product-led discovery.
- Add personalised proof sections when the reason is truthful.
- Add merchant acquisition reporting.

### Stage 5 — merchant insights and offer opportunities

- Launch aggregate insights in the Akiba-Platform merchant dashboard.
- Add reviewed rule-based offer opportunities.
- Measure offer creation and incremental conversion.

### Stage 6 — Phase B social showcase

- Proceed only after all §14.3 launch gates are met.
- Pilot with a small set of visually suitable, operationally engaged merchants.

Each stage has an independent kill switch. No stage depends on fabricating
proof for merchants that have not reached the threshold.

---

## 19. Testing and acceptance criteria

### 19.1 Data correctness

- Duplicate earning events do not create duplicate evidence or requests.
- Notification preferences do not affect earning-event persistence.
- A reward/contribution failure never changes the other system's committed
  state.
- Reversed and disputed events are excluded.
- Same-member/same-merchant/day popularity deduplication is deterministic.
- Every public label maps to its specified evidence type and window.
- Under-threshold values are absent from every public response.
- Sample bands cannot reveal a suppressed exact count.
- Item recommendations cannot cross merchant boundaries.
- A recommendation contribution cannot be created from an online, unknown-
  channel, reversed or disputed earning event.
- Spend is never derived from Miles; only authoritative paid amounts with
  eligible exact party sizes enter the per-person aggregate.
- `6+`, missing party size, refunds, reversals and mixed currencies are
  excluded from the public spend band.
- Multiple events or photos from one member do not satisfy a unique-member
  threshold.
- Spelling and punctuation variants can merge without double-counting a member.
- One customer's new product label cannot create a public discovery item.
- A suppressed or merged item disappears from the next public snapshot.
- An experience tag below either its count or share threshold is absent from
  every public response.
- Pending, rejected, withdrawn and source photo objects are never publicly
  readable or returned by public APIs.
- Merchant-authored images never enter the verified-visit gallery or count as
  verified proof, recommendations or unique-contributor totals.
- Public merchant responses whitelist media fields and never expose catalogue
  prices, inventory, contributor identity or raw photo storage keys.
- Withdrawing a photo removes its derivatives from snapshot and cache within
  the §16.3 target without withdrawing the structured contribution.
- Merchant insight cohorts below five unique members are suppressed.

### 19.2 Mobile and accessibility

- Complete the contribution flow at 320px without horizontal scrolling.
- Complete camera/library selection, photo retry and removal at 320px without
  trapping focus or losing the saved structured contribution.
- Test 375px, 414px, tablet portrait and landscape.
- Test 200% browser zoom and the largest supported text configuration.
- Every target is at least 44×44 CSS pixels with adequate spacing.
- Bottom navigation and sheets respect safe-area insets.
- Keyboard and screen-reader order match visual order.
- All images have correct meaningful/decorative alternatives.
- The gallery viewer works with keyboard and screen reader controls without
  requiring swipe gestures.
- Focus is visible and never hidden by sticky UI.
- Rails have visible button/keyboard alternatives to swiping.
- Reduced-motion mode removes non-essential movement.
- Loading, success and inline error states are announced without unexpected
  focus movement.

### 19.3 Performance and resilience

- No third-party social/player JavaScript in Phase A.
- Card media reserves space and creates no material CLS.
- Below-fold media is lazy loaded.
- Customer-photo originals are never delivered to public clients; derivative
  dimensions and `sizes` avoid oversized phone downloads.
- Home search and intents render when proof aggregation fails.
- One failed rail does not take down another.
- Slow-3G and reduced-data tests preserve readable placeholders and actions.
- p75 mobile LCP, INP and CLS meet §5.3 targets before broad rollout.

### 19.4 Product acceptance

- A signed-out visitor can search and browse qualified public proof without an
  account.
- A signed-in eligible member can submit or dismiss in under 30 seconds.
- Only a member with a verified in-store event can create a visit card; adding
  photos remains optional after the structured contribution is saved.
- A visitor can distinguish `Verified visits` from `From the business` without
  relying on image content, colour or prior product knowledge.
- A merchant can add and manage its own business/product media without gaining
  control over the verified-customer gallery.
- The UI states that the contribution is optional and does not affect Miles.
- A member can withdraw a contribution.
- A merchant can view aggregate insights and report an incorrect item through
  Akiba-Platform without maintaining a product catalogue, and can report a
  customer photo without controlling gallery order or approval.
- A merchant cannot edit individual responses.
- Discovery, merchant-page action and verified earning attribution are
  measurable end to end.

---

## 20. Implementation map

Likely Hub changes:

- `src/app/MemberHome.tsx` and `VisitorLanding.tsx` — acquisition-led ordering;
- `src/components/home/DiscoveryMasthead.tsx` — new promise and location
  context;
- `src/components/home/MerchantValueCard.tsx` — split context, proof and value;
- new `DiscoveryItemCard`, proof section and contribution-nudge components;
- `src/lib/home/types.ts` and `feed.ts` — public proof/item section contracts;
- `src/app/merchants/[slug]/page.tsx` — decision-page hierarchy and proof;
- provenance-labelled merchant/customer photo tabs and accessible viewer;
- new protected visit-card contribution route and leaf Client Components;
- first-party photo picker/uploader, qualified merchant gallery and accessible
  viewer;
- `src/lib/akiba/milesEarnedNotification.ts`, `reward-release.ts` and
  `/api/internal/miles-credited` — idempotent discovery-event recording without
  coupling it to notification preferences;
- route-level loading/error treatment and section Suspense boundaries.

Required Akiba-Platform changes, outside this repository:

- merchant-facing public-proof participation controls;
- primary-action configuration;
- customer-generated item report/correction workflow;
- customer-photo category toggle and report workflow;
- merchant business/product media upload, processing, ordering and removal,
  plus the public `merchantMedia` projection;
- aggregate customer-discovery insights;
- offer-opportunity review;
- authenticated internal settings and insight-snapshot contracts with Hub.

The in-repository `packages/merchant-dashboard` is not an implementation target
for this feature.

Likely admin-dashboard changes:

- aggregate/snapshot suppression and audit;
- question-template lifecycle;
- customer-generated item normalization/merge queue and integrity review;
- first-party photo moderation queue, rejection reasons, takedowns and appeals;
- Phase B moderation queue, reports, takedowns and appeals.

Likely infrastructure changes:

- private source-upload bucket and separate approved-derivative delivery path;
- short-lived upload-intent service and isolated image-processing worker;
- EXIF stripping, safe decoding, AVIF/WebP variants, duplicate detection and
  CDN invalidation on withdrawal or suppression.

Database changes ship through the next available numbered Supabase migration;
do not edit deployed migrations.

---

## 21. External decisions and dependencies

The spec recommends defaults, but these require named approval before broad
launch:

1. **Product/Research:** final question copy, category templates and owner.
2. **Data:** threshold calibration, confidence method, ranking weights, spend
   band method, currency handling and experiment design.
3. **Privacy/Compliance:** purpose notice, withdrawal/retention, customer-photo
   licence and policy, sensitive categories and Phase B social consent.
4. **Akiba-Platform:** merchant settings and insight contracts, durable earning
   reversal/dispute events, authoritative in-store channel and paid-amount
   fields, trusted item/branch hints on merchant-scan credits, and the
   merchant-media write/public-read contract.
5. **Merchant Success:** pilot merchants and merchant communication; no product
   catalogue setup is required.
6. **Analytics owner:** production provider, discovery-session contract and
   attribution implementation.
7. **Admin Operations:** item integrity review and first-party photo moderation
   in Phase A, plus separate social moderation ownership before Phase B.

None of these dependencies justify displaying unverified or under-threshold
claims. When a contract is missing, the corresponding UI remains absent.
