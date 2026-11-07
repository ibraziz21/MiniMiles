# Akiba — Play Store listing SEO (ASO)

Companion to [`metadata.md`](./metadata.md). That file is the pre-submission
draft; this one is the optimisation pass against the **live** listing
(`com.akibamiles.akiba`, verified 4 November 2026).

Same rule applies: nothing here may describe a feature the production
capability response hides (Gifts, Games, raffles, push) or a screen absent
from the shipped binary.

## Positioning (decided 4 November 2026)

Akiba's two purposes, in order:

1. **Find local places** to shop, eat and enjoy.
2. **Get rewarded for spending** at them.

**Loyalty framing is out.** An earlier pass of this document led on *loyalty*
— "loyalty rewards", "one loyalty app instead of many loyalty cards",
"loyalty balance" — and that was wrong twice over. It is not how the product
is positioned any more, and as an ASO target it aims at the wrong search
intent: `loyalty rewards` in Kenya returns Loyalteey, Loyvo, LoyalStamps and
Loopy, which are merchant-side stamp-card tools, not consumer discovery apps.
Nobody searching that term is looking for Akiba. All listing copy below leads
with discovery and frames the reward as something you get at the place you
spend, not as a programme you enrol in.

## What is live today

| Field | Live value |
|---|---|
| Title | `Akiba` (5 / 30 chars) |
| Short description | `Discover local offers, earn Miles and unlock rewards where you shop.` (68 / 80) |
| Category | Shopping |
| Content rating | Rated for 3+ |
| Developer | Akiba Ecosystems Ltd |
| Downloads · rating | 0+ · none |
| Updated | 20 October 2026 |
| Localisations | English (US) only |

Kenya web session, 4 Nov 2026 — `play.google.com/store/search?q=akiba&c=apps`:
Akiba Ecosystems ranks **5th**, behind Akiba (Vetiva Capital), Akiba Mobile
(Kayiv), Akiba Software (PACOME ISSA) and Akiba yangu (Swahili ICT). Akiba
Commercial Bank and AkibaPlus sit just below. Position varies by session and
device; there is no single universal rank.

## The actual constraint

"Akiba" is *savings* in Swahili, so the brand term is a crowded head term
owned by banks and savings apps with years of install history. Metadata alone
will not win it: Play weights installs, retention, ratings and uninstall rate
heavily, and the listing currently presents **0+ downloads and no rating**.

The opening is elsewhere. Searches run in a Kenya web session, 4 Nov 2026:

| Kenya query | What ranks | Verdict |
|---|---|---|
| `offers near me` | dealboX, nearbuy (India), Groupon, Prospecto (Hungary) | **Target.** No Kenyan local-offers app at all |
| `offers kenya` | Jumia, Kilimall, loan apps, news apps, `AIRTIME DEALS KENYA` | **Target.** Intent completely unserved |
| `nairobi deals discounts` | Groupon, Slickdeals, hotukdeals, `PataDeals` (Hansel Technologies) | **Target.** PataDeals is the one local competitor to track |
| `vouchers discounts` | Coupon/promo-code aggregators, all non-Kenyan | **Target.** Open |
| `places near me` | Near Me Places, AroundMe, Tripadvisor, MAPS.ME | **Secondary.** Weak field, but the intent is maps/tourism, not spending |
| `loyalty rewards` | Loyalteey, Loyvo, LoyalStamps, Loopy | **Drop.** Merchant-side stamp tools; wrong audience |
| `restaurants near me` | Uber Eats, Deliveroo, OpenTable, Menufinderafrica | **Avoid.** Delivery intent, and an unwinnable head term |
| `shops near me` | Jumia, Kilimall, AliExpress, Jiji, Shopify Shop | **Avoid.** E-commerce intent, not walk-in |
| `earn rewards shopping` | Freecash, LootUp, Pawns.app, survey and get-paid-to apps | **Avoid deliberately** — see below |

**The `earn rewards` neighbourhood is a trap.** That query returns a wall of
get-paid-to, survey and cashback apps promising withdrawable cash. Ranking
there would bring installs from people expecting a payout, who then discover
that AkibaMiles cannot be withdrawn or converted to cash and leave one-star
reviews. Given that ratings are the thing currently capping the listing,
wrong-intent installs are worse than no installs. So express purpose 2 as
*offers, vouchers and getting something back where you spend* — never as
"earn rewards" or anything resembling cashback.

Strategy, then: treat "akiba" as brand defence (make the right Akiba
unmistakable), lead the copy on **local place discovery in Kenya**, and
compete to win on **Kenya-qualified offers, deals and voucher terms** — the
intersection of local, in-person and Kenyan, which nobody holds.

## 1. Title — 30 char limit

**Recommended:** `Akiba: Local Places & Offers` — 28 / 30 characters.

Keep the brand name Akiba. Google Play has no separate keyword field, so retain AkibaMiles naturally in the full description, including the opening paragraph. The name does not need to change to target that query.

Publish the description in Play Console’s main store listing and each supported localization. Uploading an Android bundle does not apply store listing copy. Verify `akibamiles` and `akiba miles` after the metadata is published and indexed. Search placement depends on relevance, availability and the store’s ranking system.

Do **not** rename the developer account. It is indexed, but "Akiba Ecosystems
Ltd" already carries the brand, and a change resets nothing useful.

## 2. Short description — 80 char limit

**Recommended** (73 / 80):

> Discover local shops and cafés in Kenya, and get rewarded when you spend.

Adds `shops`, `cafés`, `Kenya`, `rewarded`, `spend` — none of which the title
carries — and states both purposes in the one line that shows above the fold.
"Get rewarded when you spend" names the mechanic without using the phrase
"earn rewards", so it reads as a place you walk into rather than a payout app.

| Alternative | Chars | When to use |
|---|---|---|
| `Discover shops, cafés and businesses in Kenya. Get rewarded when you spend.` | 75 | Adds "businesses"; two sentences read slightly flatter |
| `Find local places in Kenya and get rewarded every time you spend there.` | 71 | Repeats "local places" from the title instead of adding new terms |

## 3. Full description — 4000 char limit

Rewrite below, 2,132 / 4,000 characters, revised 4 Nov 2026 after copy
review. Four changes from the live copy: *places* becomes the lead noun
throughout, the opening sentence names Kenya, the reward sections are framed
as what you get where you spend, and the word *loyalty* appears nowhere.

**Earning eligibility is stated consistently.** Every mention of earning is
qualified — "eligible purchases at participating businesses" — including the
opening sentence, which in an earlier draft promised something back *every
time you spend*. That was an overclaim against the app's own rules and it
contradicted the three later mentions that were already qualified. It also
mattered beyond accuracy: an unqualified earning promise is exactly what the
get-paid-to audience reads as a payout guarantee. The cost is that *spend*
now appears twice rather than four times; that is an acceptable loss, since
"spend" is not a term anyone searches.

Measured density: 12× place, 11× Miles, 8× voucher, 7× offer, 7× reward, 6×
business, 5× shop, 4× Kenya, 4× eligible, 3× local, 3× near, 3× café, 2×
spend, **0× loyalty** — repetition through natural phrasing, not a keyword
list.

Note the section order. Discovery leads and takes two sections; the Pass and
Miles mechanics follow as the payoff rather than the pitch. The live copy's
"ONE LOYALTY APP FOR MANY MERCHANTS" section is deleted outright, not
reworded — the "instead of carrying many loyalty cards" argument is the old
positioning in miniature.

Each paragraph below is a single line, so it pastes into Play Console without
stray mid-sentence line breaks. Blank lines are intentional.

```text
Akiba helps you find local places to shop, eat and enjoy in Kenya, and collect AkibaMiles on eligible purchases at participating businesses.

Discover shops, cafés and businesses around you, see their available offers, and earn AkibaMiles on eligible purchases. Turn those Miles into vouchers for future visits.

FIND LOCAL PLACES NEAR YOU

Explore shops, cafés and businesses in the Akiba network across Kenya. View photos, location, opening information and what each place is offering before you decide where to go. Browse by city, or use Near me to find places close to you.

SEE WHAT EACH PLACE IS OFFERING

Offers come straight from the businesses themselves — limited-time specials, weekly deals and member discounts at real places you can walk into. Swipe through the offers that interest you. Many need no AkibaMiles at all: check the availability and visit.

GET REWARDED WHEN YOU SPEND

Show your Akiba Pass when you pay at a participating place. The merchant scans your pass and eligible purchases earn AkibaMiles. There is no card to carry and no balance to top up — just show your Pass at the places you already like.

TURN MILES INTO VOUCHERS

Use your AkibaMiles to unlock vouchers and rewards from participating businesses. Find active vouchers ready to redeem, and keep track of your used and expired vouchers in the app.

WITH AKIBA, YOU CAN:

• Find local places to shop, eat and enjoy near you in Kenya
• Discover shops, cafés and businesses in the Akiba network
• See photos, locations and opening information for each place
• Browse the offers and deals each place is running
• Earn AkibaMiles on eligible purchases when you spend
• Turn Miles into vouchers and merchant rewards
• Keep track of your Miles, vouchers and reward activity

Signing in takes one email address — we send a 6-digit code, so there is no password to remember.

AkibaMiles are a rewards balance, not money. Miles cannot be withdrawn, transferred or converted to cash; they can only be exchanged for vouchers redeemable with participating merchants.

Akiba is available in Kenya. Participating places, offers and reward availability may vary.
```

The disclaimer keeps its legal substance — Miles are not withdrawable, not
transferable, not cash — with "loyalty balance" changed to "rewards balance".
Worth keeping verbatim; with the `earn rewards` category being what it is,
that paragraph is also what stops a reviewer or a user reading Akiba as a
cash-payout app.

It deliberately says **vouchers only**. If Miles can also be exchanged for
something that is a discount rather than a voucher, the sentence needs to say
so — but it must not list an exchange path the app does not offer, which is
why "vouchers and discounts" is not used here.

Claims to re-verify against the shipped binary and the live merchant network
before publishing, per `metadata.md`: **"shop, eat and enjoy"** (does the
network actually cover all three?), **"cafés"**, **"Browse by city"**,
**"Near me"**, **"opening information"** and **"Swipe through"**. Drop any
that does not hold — a listing that overstates the network is both a policy
risk and a conversion problem once people install. Leading on discovery
raises the stakes here: if someone opens the app and the map of places near
them is thin, the first thing the listing promised is the first thing that
disappoints, and that lands in the ratings.

Already verified in code, so these need no further check:

- **"Find active vouchers ready to redeem, and keep track of your used and
  expired vouchers"** — `src/app/(tabs)/vouchers/index.tsx:84` renders
  exactly three status tabs, "Ready to use" / "Used" / "Expired", under the
  heading "Your voucher history, kept together". The revised wording tracks
  the app's own labels.
- **"Many need no AkibaMiles at all"** — the same screen has a "Free offers"
  tab counting offers with `acquisitionMode === 'free'` alongside the
  Miles-priced "Shop" tab.

## 4. Levers beyond the three text fields

Ranked by expected effect at the current install base.

1. **First ratings are worth more than any wording.** At 0+ downloads and no
   rating, keyword rank is capped regardless of copy. There is **no in-app
   review prompt in the app** — nothing in `packages/akiba-app/src` references
   `expo-store-review` or the Play In-App Review API. Adding it behind a
   genuine success moment (voucher redeemed, Miles credited) is the single
   highest-leverage change available, and it is an app change, not a listing
   change.

2. **The website does not link to the Play listing.** `packages/hub-page`
   serves a crawlable sitemap plus public `/merchants` and `/offers` pages,
   and `grep -r "play.google.com" src/` returns nothing. Installs arriving
   from external referrers count toward Play ranking, and a crawlable page
   linking the listing also feeds Google Search's branded app results. Add an
   install CTA to `VisitorLanding`, the merchant pages and the offer pages,
   with a tagged link:
   `https://play.google.com/store/apps/details?id=com.akibamiles.akiba&referrer=utm_source%3Dhub%26utm_medium%3Dweb`.

3. **Add a Swahili (`sw`) store listing.** Play indexes keywords per locale,
   so this is a second keyword surface rather than a translation chore, and it
   reaches devices set to Swahili. Needs a native speaker — note that *akiba*
   itself means savings, so the Swahili copy must lean on place-finding plus
   *ofa* (offers) and *punguzo* (discounts) rather than on *akiba* or on
   anything that reads as a savings product.

4. **Set the five store-listing tags** (Play Console → Grow → Store presence
   → Store settings). Pick the local-discovery and coupons/discounts Shopping
   tags over generic retail or rewards-programme ones; tags feed category
   browse and similar-app placement, not keyword search. Keep **Shopping** as
   the category — it is where offer and deal intent lives, and Lifestyle would
   lose those browse surfaces.

5. **Merchant-side acquisition at the point of sale.** Till-side QR to the
   tagged Play link turns existing merchant footfall into install velocity,
   which is the input Play actually rewards. This is the main way out of the
   0-install cap.

6. **Store listing experiments** (A/B test icon, short description, first
   screenshot) — correct tool, but it needs traffic to reach significance.
   Park it until the listing sees meaningful weekly visits.

7. **Screenshot captions are not indexed**, so they are a conversion lever
   only — but the order now matters. Under the new positioning the first frame
   should be discovery (the Explore or Merchants screen, captioned along the
   lines of "Find local places near you"), and the second the payoff ("Get
   rewarded when you spend"). The existing `store-assets/android` set already
   leads with `store-01-explore`, so this is a caption and sequencing pass,
   not a re-shoot.

## 5. Baseline to measure

Weekly, from a Kenya session or Play Console → Acquisition:

- Rank for `akiba` (brand defence) and for `offers near me`, `offers kenya`,
  `nairobi deals`, `local offers`, `places near me` — the terms worth
  winning. Do not track `loyalty rewards` or `earn rewards`; appearing there
  is a signal the copy has drifted back toward the wrong audience.
- Play Console store-listing visitors, install conversion rate, install
  source breakdown (search vs. explore vs. external referrer).
- Ratings count and average — the gate on everything above.

Expect the Kenya-qualified long-tail terms to move within a couple of weeks of
publishing the copy. The brand head term will not; it needs installs, ratings
and retention, measured over months.

## 6. Unrelated discrepancy found while reading the listing

The live listing shows **Rated for 3+**, while `metadata.md` records the
intended rating as **18+, to match the Terms** (owner: Product / Legal, never
signed off). Not an SEO issue, but worth resolving — the content-rating
questionnaire answers and the Terms should agree.
