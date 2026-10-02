# Merchant Discovery Media and Customer Intelligence Specification

**Status:** Proposed V1 contract  
**Merchant product owner:** Akiba-Platform  
**Consumer surface:** Hub `/merchants/[slug]`  
**Supporting systems:** Hub verified earning/contribution pipeline, Akiba Admin Operations, voucher platform  
**Related specifications:**

- `verified-discovery-acquisition-v1-spec.md`
- `verified-discovery-market-readiness-hardening-spec.md`
- `post-visit-store-mission-spec.md`
- `merchant-directory-in-store-discovery-spec.md`

---

## 1. Decision summary

Akiba-Platform adds one merchant-owned product area named **Customer
discovery**. It gives authorised merchant users two capabilities:

1. manage business and product media that Hub labels **From the business**;
2. understand aggregated choices submitted by customers after verified visits,
   then turn qualified findings into reviewed actions such as a profile update,
   stock/service follow-up or draft voucher.

Merchant media and verified-customer evidence are separate data sources with
separate permissions and labels:

| Source | Merchant control | Hub label | Verification meaning |
|---|---|---|---|
| Merchant business/product media | Add, caption, order, replace, remove | `From the business` | Merchant-authored; never verified customer proof |
| Qualified customer visit photos | Report only | `Verified visits` | Contributor eligibility was verified; the image is not proof by itself |
| Structured post-purchase answers | View only as aggregates | Verified customer insights | Aggregate signal after the relevant threshold |

Merchants never receive a customer identity, raw response, earning-event id,
payment reference or raw customer-entered label. They cannot edit, approve,
reject, reorder or cherry-pick verified-customer content.

The member activity is called a **verified visit contribution**, not a public
review. V1 contains structured choices and optional photos; it does not publish
individual ratings, comments, names or profiles.

---

## 2. Product outcome

The merchant experience answers five practical questions:

1. What do verified customers choose and explicitly recommend?
2. What kind of visit or group is this merchant working well for?
3. Why do some customers say `Not this time`?
4. Which profile/media gaps make the merchant harder to choose?
5. What is the next evidence-backed action the merchant may take?

The desired loop is:

```text
verified visit
  → structured customer choices
  → privacy-safe merchant insight
  → merchant-reviewed action or voucher draft
  → later verified purchase/redemption
  → measured outcome
  → better next recommendation
```

V1 succeeds when a merchant can understand a qualified signal and take an
appropriate action without reading individual reviews or interpreting a dense
analytics dashboard.

### 2.1 Goals

- Give merchants useful, first-party aggregate intelligence from verified
  visits.
- Keep reported purchases, recommendations and authoritative purchases
  semantically distinct.
- Let merchants improve visually empty profiles without weakening the meaning
  of verified customer photos.
- Surface operational feedback as well as promotional opportunities.
- Produce draft actions, never automatic public claims or offers.
- Close the loop with attributable verified purchases, repeat visits and
  voucher redemptions.
- Work for merchants with no product catalogue; catalogue linkage is an
  enhancement, not a prerequisite.

### 2.2 Non-goals

- Individual reviews, public comments or merchant replies.
- Customer identity lookup or CRM profile export.
- Raw response download.
- Merchant moderation of customer photos.
- Merchant-authored customer-favourite labels.
- Automatic discounts, automatic voucher publication or paid organic ranking.
- Inventory forecasting from customer wording alone.
- Cross-merchant market intelligence or the broader Demand Snapshot product.
- Treating merchant media engagement as verified customer endorsement.

---

## 3. Evidence and terminology

Every number or claim shown to a merchant names its evidence type.

| Term | Definition | May support |
|---|---|---|
| Verified visit | Active authoritative in-store earning event for this partner | Contribution eligibility, visit/repeat analysis |
| Reported item | Item the member says they got or confirms from trusted line-item hints | `Customers reported trying` |
| Explicit recommendation | Reported item the member separately selects when asked what they would tell someone to try | `Most recommended` |
| Authoritative purchase | Product/line item supplied by an authoritative commerce contract | `Purchased`, inventory/commerce analysis |
| Place recommendation | Answer to `Would you send a friend here?` | Recommendation rate |
| Private negative reason | Optional structured reason after `Not this time` | Merchant-only operational feedback |
| Experience tag | Centrally curated choice such as `Great for working` | Visit-fit insight and qualified public tag |
| Party context | Optional count of people covered by the purchase | Group-context insight; eligible per-person spend |
| Customer photo | Moderated image submitted after a verified contribution | Qualified `Verified visits` gallery |
| Merchant media | Business or product image supplied by an authorised merchant user | `From the business` gallery only |

Never label a reported item as `purchased` unless an authoritative line-item
contract supports it. Never label an item `recommended` merely because it was
reported or frequently purchased.

---

## 4. Ownership and roles

### 4.1 System ownership

- **Akiba-Platform** owns merchant authentication, role checks, merchant media
  mutations, settings, intelligence reads and opportunity actions.
- **Hub** owns verified earning ingestion, member contributions and the public
  merchant-page rendering contract.
- **Akiba Admin Operations** owns customer-photo moderation, customer-generated
  item normalisation, suppression, appeals and platform takedowns.
- **The voucher platform** owns voucher validation, draft/publish lifecycle,
  issuance and redemption.

Hub must not add a second merchant settings or intelligence UI.

### 4.2 Merchant roles

| Capability | Owner | Manager | Staff |
|---|:---:|:---:|:---:|
| View qualified aggregate intelligence | Yes | Yes | Optional permission |
| View opportunity recommendations | Yes | Yes | Read-only if granted |
| Create a voucher draft from an opportunity | Yes | Yes | No |
| Publish/activate a voucher | Existing voucher permission | Existing voucher permission | No |
| Add/edit/reorder/remove merchant media | Yes | Yes | No |
| Change discovery participation settings | Yes | No | No |
| Report a customer item or photo | Yes | Yes | Yes |
| View audit history | Yes | Read-only | No |

All mutations verify the server session's `partner_id`; a client-supplied
partner id is never authoritative.

---

## 5. Merchant information architecture

Add one primary navigation destination: **Customer discovery**.

Recommended child views:

1. **Overview** — strongest qualified signals, coverage and next actions.
2. **What customers choose** — reported items, recommendations and purchase
   evidence kept separate.
3. **Visit fit** — experience tags, party context, spend bands and visit mix.
4. **Private feedback** — aggregate `Not this time` reasons and trends.
5. **Photos & media** — merchant-owned media management plus read-only customer
   gallery status.
6. **Opportunities** — reviewed recommendations and outcome history.

On small screens these may be stacked sections behind an in-page selector. On
desktop they may be routes or tabs. URLs must be deep-linkable and preserve the
selected date window.

### 5.1 Overview

The first viewport shows at most three signal cards and one primary next
action. It is not a wall of charts.

Example:

```text
Customer discovery                         Last 90 days

86% would recommend                        25+ verified responses
Most recommended: Spanish Latte            Strong confidence
Known for: working, friendly staff          Up vs previous period

Opportunity: Help weekday visitors return
Customers recommend your lunch items, but verified 30-day repeat is lower
than your own prior period.
[Review opportunity]
```

Every card includes:

- the evidence label;
- source window;
- sample band or coverage state;
- comparison against the merchant's own previous equal period when qualified;
- a short `How this is calculated` explanation;
- no comparison against another named merchant.

### 5.2 Date and location filters

- Default signal window: trailing 90 days.
- Supported presets: 30 days, 90 days and 12 months where data permits.
- Funnel/acquisition default: trailing 30 days.
- Branch filter appears only when verified events contain an authoritative
  branch id with sufficient coverage.
- `All branches` remains the default.
- Changing a filter updates all compatible cards and clearly marks cards that
  cannot use that dimension.
- Below-threshold segments render `Not enough verified visits yet`, never
  partial values.

### 5.3 Early-data state

Before the first insight qualifies, Overview shows a readiness checklist
instead of empty charts or network-wide benchmarks:

- confirm that contribution requests are enabled;
- confirm profile action, hours and location details;
- add business/product media;
- explain that insights arrive only after verified visits and sufficient
  unique customers;
- show `Last checked` and source availability without revealing a suppressed
  response count.

The merchant is never asked to manufacture products, ratings or customer
claims to escape the empty state.

---

## 6. Photos and merchant-managed media

### 6.1 Merchant media library

The **From the business** manager supports:

- business/location photos;
- product photos linked to an optional merchant-owned product;
- a short title;
- meaningful alt text;
- drag or button-based ordering;
- set/unset profile cover where permitted;
- replace, unpublish and remove;
- preview of the Hub `From the business` tab.

V1 defaults:

- maximum 24 published gallery images per merchant;
- JPEG, PNG, WebP and HEIC still images up to 10 MB;
- business or product kind required;
- product linkage optional and limited to the same partner;
- no customer names, testimonials, ratings or `customer favourite` wording in
  merchant captions;
- no video, GIF, third-party social embeds or external tracking pixels.

The limit is configurable. Existing banner and active product images may seed
the public projection during migration, but they should appear only once after
URL/content deduplication.

### 6.2 Upload flow

1. Owner or manager chooses `Add photos`.
2. The server issues short-lived, partner-bound upload intents.
3. The browser uploads originals to private storage.
4. A worker validates magic bytes and decoded content, enforces size/pixel
   limits, strips metadata and writes safe thumbnail/display derivatives.
5. Automated checks may reject obviously unsafe or invalid files; uncertain
   cases enter operational review.
6. Successful media becomes `ready`; the merchant chooses `Publish`.
7. The public `merchantMedia` projection updates within the publication SLO.

Originals are never served on Hub. Upload completion accepts only the object
key issued for the authenticated partner and media id.

### 6.3 Media statuses

```text
uploading → processing → ready → published → removed
                         ↘ rejected
published → suppressed
```

- `ready` is visible only to the merchant team.
- `published` may enter Hub's `From the business` tab.
- `rejected` includes a safe reason and retry guidance.
- `suppressed` is an Akiba Operations action; the merchant sees the reason and
  appeal route but cannot republish it.
- `removed` disappears from the public projection and CDN within the removal
  target.

### 6.4 Customer-photo status

The same screen shows a separate read-only **Verified visits** panel:

- whether customer photos are enabled for this merchant;
- `Collecting`, `Gallery live` or `Paused` status;
- public sample band, not contributor identities;
- count of currently public gallery photos only when safe to display;
- gallery views and opens;
- report action for policy, privacy or relevance concerns.

Merchants cannot approve, reject, reorder, caption, download originals or
select the cover image for customer photos. A report creates an Operations
case; it does not immediately hide content unless an emergency policy says so.

### 6.5 Hub contract

Hub renders one Instagram-style merchant profile surface with up to three tabs:

- `Verified visits` from `approvedCustomerPhotos`;
- `From the business` from `merchantMedia`;
- `Locations` from the merchant's public branch projection, when at least one
  physical location exists.

The two photo-source tabs remain discoverable when either collection has public
images. `Locations` is omitted for online-only merchants. The first photo source
with images is selected by default; a location-only profile selects `Locations`.
Merchant media never fills, pads or qualifies the verified tab.

On narrow screens, the tab rail uses compact visible labels while retaining the
full accessible names `Verified visits`, `From the business` and `Locations`.
Branch directions remain available from both the profile header and the
location cards. Vouchers remain outside this profile-content rail because they
are transactional rather than profile content.

The `Verified visits` panel includes an `Add your visit` entry point. It must
resolve the signed-in member's open, unexpired contribution request for this
merchant before entering the contribution flow. If live request ingestion was
missed, Hub may reconcile a recent authoritative AkibaMiles issuance into
verified earning evidence. Current scan awards use a `purchase` ledger credit
linked to a rewarded, positive-net, non-reversed purchase event with an
authoritative `in_store` channel; legacy `merchant` scan credits remain
supported. Hub then runs the same guarded request-creation contract. It never
accepts a generic review or bypasses merchant settings,
expiry, cooldown or fatigue controls. When no eligible issuance exists, Hub
explains that a qualifying in-store Akiba purchase is required.

For the contributing member only, this tab also renders an immediate private
confirmation that their verified visit was saved and reports the status of any
optional photo. It is not a public review card and never enters the anonymous
merchant projection; public customer proof remains moderated, aggregated and
threshold-gated.

---

## 7. Customer-choice intelligence

### 7.1 Answer-to-insight map

This table is the canonical interpretation of the choices made in the member's
post-purchase visit contribution.

| Member choice | Merchant insight | Denominator | Public use |
|---|---|---|---|
| `Yes, I would` / `Not this time` | Place recommendation rate | Members answering yes or no; skip excluded | Thresholded recommendation signal |
| Private reason after `Not this time` | Negative-reason distribution | Members choosing a reason after a negative answer | Never public in V1 |
| `Just me`, `2`…`5`, `6+` | Party-context distribution | Members answering party context | Distribution private; eligible exact sizes may support public spend band |
| Item named or confirmed | Reported-item reach | Members who submitted at least one item | Qualified canonical item may become public |
| Item selected as `tell someone to try` | Explicit item recommendation | Members reporting that item | Qualified customer favourite |
| Experience chips | Experience-tag reach | Eligible positive respondents selecting at least one tag | Qualified top tags |
| Optional photo | Customer-photo coverage | Eligible contributors with an approved active photo | Qualified verified gallery |
| No answer / skip | Coverage only | Eligible contribution requests | Never interpreted as negative sentiment |

V1 path semantics matter:

- `Not this time` may collect one private negative reason, then finishes; the
  absence of items, positive experience tags or photos on that path is not a
  negative vote on those fields;
- skipping the place recommendation may continue to party context and reported
  items, but does not create an explicit place or item recommendation;
- only a positive place recommendation unlocks `tell someone to try`, positive
  experience tags and optional public-photo contribution.

The aggregation unit is one eligible member/merchant/local-calendar-day. If
legacy or concurrent data produces more than one eligible contribution in that
unit, select the earliest submitted contribution by `submitted_at, id`, then
use its latest active answer version. Privacy qualification is separate:
aggregate insight thresholds count distinct eligible members, not member-days.
The photo gallery is the exception: every individually moderated photo is
eligible immediately after approval.

### 7.2 Recommendation signal

Display:

- `Would recommend` rate;
- positive and negative sample band;
- change against the previous equal period when both periods qualify;
- first-time vs returning-customer split when both segments qualify.

Calculation:

```text
recommendation_rate = eligible deduplicated member-day answers of Yes
                      ÷ eligible deduplicated member-day answers of
                        Yes or Not this time
```

Skipped recommendation answers are excluded from numerator and denominator.
Withdrawn, reversed, disputed, suppressed and integrity-excluded contributions
are excluded. Do not convert an absent answer into `Not this time`.

### 7.3 Private negative reasons

Display aggregate reasons only after the negative-answer subgroup independently
meets the merchant-private threshold. Supported V1 reasons are template-owned,
for example:

- product quality;
- service;
- value;
- availability;
- convenience;
- something else.

Rules:

- show share within reason respondents, not share of every visitor;
- distinguish `No reason selected` from a named reason in coverage, but do not
  rank it as operational feedback;
- combine low-frequency reason buckets into `Other feedback` where needed to
  prevent reconstruction;
- no raw text is shown because V1 does not collect public or merchant-visible
  free-text criticism;
- a rising service or availability reason creates an operational alert, not a
  discount recommendation by default.

### 7.4 What customers choose

The page uses three visually separate lists:

1. **Customers reported trying** — normalised customer item mentions.
2. **Customers recommend** — explicit `tell someone to try` selections.
3. **Purchased through Akiba** — authoritative line-item evidence only.

For each qualified item show:

- canonical display name;
- evidence label;
- unique-member sample band;
- reach within the relevant respondent group;
- trend against the prior equal period when qualified;
- first-time/returning mix when qualified;
- whether the merchant has a matching product record and usable product photo.

Recommended-item rate is:

```text
item_recommendation_rate = eligible deduplicated member-day units recommending
                           the item
                           ÷ eligible deduplicated member-day units reporting
                             that item
```

The dashboard must not claim an item is a bestseller without authoritative
purchase quantity. Customer wording cannot update product inventory or price.

### 7.5 Visit fit and experience tags

Display up to eight centrally curated tags with:

- share of eligible tag respondents;
- sample band;
- trend;
- first-time/returning split where qualified.

The denominator is eligible deduplicated member-day responses from positive
place recommenders who reached the tag step and selected at least one tag.
Members who were not shown the question are not in the denominator. A skipped
tag step is coverage loss, not a negative vote. Qualification still uses the
distinct-member threshold.

Merchants cannot create or rename experience tags. They may report a template
as irrelevant; Akiba owns category-template changes.

### 7.6 Party context and spend

The private party distribution may show `1`, `2`, `3`, `4`, `5` and `6+` after
the cohort qualifies. `6+` supports group-context insight but is excluded from
per-person spend calculations.

Keep these measures separate:

- median authoritative paid amount per purchase;
- eligible typical-paid-per-person band;
- percentage of events with sufficient amount and exact party-size coverage.

Never derive money from Miles. Do not combine currencies or perform implicit
foreign-exchange conversion. Missing amount, unknown party size, `6+`, refund,
reversal, dispute and failed integrity checks are excluded from per-person
spend.

### 7.7 First-time and returning behaviour

Classify the member at the time of each verified earning event:

- **first-time** — no earlier active verified earning event at the merchant;
- **returning** — at least one earlier active verified earning event;
- **repeat within 30 days** — a later active verified event occurs within 30
  days of the qualifying event.

Show:

- new vs returning visit mix;
- item/tag differences only when each segment independently qualifies;
- 30-day repeat rate;
- change against the merchant's own previous period.

Do not expose member-level visit histories or compare a named customer segment
below threshold.

### 7.8 Discovery and conversion funnel

The funnel may show:

```text
qualified discovery impression
  → merchant-page visit
  → high-intent action
  → attributed first verified purchase within 7 days
  → second verified purchase within 30 days
```

High-intent actions include directions, configured order/website action and
eligible voucher acquisition. Contact/social taps are reported separately
unless attribution rules explicitly classify them.

Each stage names its attribution window and coverage. Do not imply causality;
the correct copy is `followed by a verified purchase`, not `caused a purchase`.

### 7.9 Photo intelligence

Display:

- eligible contributions with an attempted photo;
- processed, pending, approved and rejected bands where safe;
- whether the public verified gallery qualifies;
- verified-gallery impressions and opens;
- merchant-media impressions and opens separately;
- product media gaps for qualified recommended items.

Never rank customer contributors, identify them or expose rejection details
that could reveal a person. Merchant-media engagement must not be blended into
verified-photo engagement.

### 7.10 Coverage and confidence

Every insight has one state:

- `Collecting` — below the unique-member threshold;
- `Directional` — threshold met but sample/coverage is limited;
- `Strong` — configured sample and coverage targets met;
- `Unavailable` — source contract is absent or invalid;
- `Paused` — merchant or Akiba setting prevents collection/publication.

V1 merchant-private minimum is five unique eligible members for the exact
cohort, segment and window. Additional safeguards:

- exact member counts are replaced with sample bands below the configured safe
  exact-count threshold;
- both comparison periods must qualify before a trend is shown;
- both sides of a segment comparison must qualify independently;
- low-frequency negative-reason buckets are combined or suppressed;
- mixed-currency spend is separated, never combined;
- coverage is shown so a merchant can see when a result represents only a
  fraction of eligible visits.

Recommended sample bands are `5–9`, `10–24`, `25–49`, `50–99`, `100+`.
Thresholds remain centrally configurable and auditable.

### 7.11 Merchant-private versus Hub-public thresholds

Seeing a private merchant insight does not mean the corresponding public claim
has qualified. The UI must show this distinction explicitly.

| Signal | Merchant-private minimum | Hub-public default |
|---|---:|---:|
| Recommendation rate | 5 unique eligible members | 10 unique contributors in 90 days |
| Canonical reported item | 5 for merchant ranking | 3 unique item mentions in 90 days |
| Customer-favourite item | 5 for merchant ranking | 5 unique explicit recommenders in 90 days |
| Experience tag | 5 unique eligible members | 5 unique contributors and 20% of eligible tag respondents in 90 days |
| Typical paid per person | 5 eligible members for private coverage/median context | 10 unique eligible contributors in 90 days |
| Customer-photo gallery | Safe aggregate status only | 1 approved active photo |
| Returning-customer label | 5 for private visit mix | 10 unique customers including at least 3 repeat customers in 90 days |
| Trending | 5 for private prior-period direction | 10 unique customers plus growth against the merchant's own baseline |

Public thresholds are controlled by the Hub discovery specification. A
merchant-private snapshot must not write or imply a public label; the public
snapshot service independently evaluates public eligibility.

---

## 8. Opportunity and action engine

### 8.1 Principle

Akiba recommends a reviewable next action. It never automatically publishes a
claim, changes a product, adjusts a price or activates a voucher.

Each opportunity contains:

- observed signal and evidence type;
- source window and sample/confidence band;
- merchant goal;
- recommended action;
- expected trade-off or risk;
- expiry;
- primary CTA;
- `Why am I seeing this?` explanation;
- dismiss action with an optional structured reason.

### 8.2 V1 opportunity rules

| Evidence pattern | Suggested action | Do not suggest |
|---|---|---|
| Strong recommended item, no usable image | Add/link a product photo | Discount merely because it is popular |
| Strong recommendation, weak qualified 30-day repeat | Review a bounce-back voucher draft | Claim the voucher will cause repeat |
| High discovery interest, low attributed first purchase | Improve primary action, hours, location or profile media; consider an acquisition offer | Hide the low conversion signal |
| First-time visitors choose one item; returning visitors choose another | Review a second-visit offer around the returning item | Target an identifiable customer |
| Group visits are common and compatible items qualify | Review a group/bundle voucher draft | Infer party spend from `6+` |
| `Availability` reason rises | Review stock/service availability operationally | Automatic discount |
| `Service` reason rises | Review service operations | Promotional voucher as first response |
| Strong off-peak recommendation with sufficient time coverage | Review a time-limited off-peak offer | Compare against another named merchant |
| Verified gallery is not qualified; merchant media is empty | Add business/product media | Place merchant media in verified tab |

Rules require a minimum confidence state and a materiality threshold. A single
response, raw label or under-threshold segment cannot create an opportunity.

### 8.3 Voucher draft flow

When an opportunity supports a voucher:

1. Merchant selects `Review voucher draft`.
2. Akiba opens the existing voucher composer with safe fields prefilled.
3. The composer shows the evidence summary and warns which values are
   suggestions.
4. Merchant reviews title, type, Miles cost, product/category, limits, branches
   and expiry.
5. Existing voucher validation and publish permissions apply.
6. Creating a draft records the opportunity link; publishing remains a
   separate explicit action.

Suggested copy must not claim public consensus unless the underlying public
threshold qualifies.

### 8.4 Opportunity lifecycle and learning

```text
suggested → viewed → draft_created → published → measuring → resolved | expired
          ↘ dismissed
```

Possible resolution measures:

- voucher acquired and redeemed;
- attributed verified first purchase;
- 30-day verified repeat;
- change in the target operational reason;
- profile media published and subsequent gallery engagement.

Resolution compares a documented pre-period and post-period where feasible.
It must label observational results as observational; V1 does not promise
causal lift without an approved experiment design.

---

## 9. Settings and merchant controls

Owner-only discovery settings:

- contribution requests on/off;
- structured customer proof public on/off;
- verified customer photos public on/off;
- future customer showcase on/off;
- primary merchant-page action;
- merchant media public on/off.

Customer-proof category toggles are all-or-nothing. A merchant cannot hide an
unfavourable metric while retaining favourable metrics from the same category.
Turning public proof off does not delete lawful historical evidence; it removes
the corresponding public projection and stops new requests where configured.

Merchant media has independent controls because it is merchant-owned content.
Removing merchant media never removes verified-customer evidence.

---

## 10. Data contracts

### 10.1 `merchant_profile_media`

```text
id                      uuid primary key
partner_id              uuid not null
kind                    text not null // business | product
product_id              uuid null
private_source_key      text not null
thumbnail_key           text null
display_key             text null
title                   text null
alt_text                text not null
sort_order              integer not null
status                  text not null
                        // uploading | processing | ready | published |
                        // rejected | suppressed | removed
moderation_reason_code  text null
created_by_user_id      uuid not null
published_at            timestamptz null
removed_at              timestamptz null
created_at              timestamptz not null
updated_at              timestamptz not null
```

Constraints:

- product linkage belongs to the same partner;
- published `sort_order` is unique per partner after normalisation;
- only `published` safe derivatives enter the public projection;
- no merchant media row references a customer contribution or customer id;
- mutations write immutable audit events.

### 10.2 `merchant_discovery_settings`

Canonical Akiba-Platform settings include:

```text
partner_id
contribution_requests_enabled
public_structured_proof_enabled
public_customer_photos_enabled
public_customer_showcase_enabled
merchant_media_enabled
primary_action_type
primary_action_url
updated_by_user_id
updated_at
```

Hub consumes only the fields needed for contribution eligibility and public
rendering through an authenticated internal contract or synchronised read
model.

### 10.3 `merchant_discovery_insight_snapshots`

One snapshot is keyed by:

```text
partner_id
branch_scope              // all or authoritative branch id
window_start
window_end
snapshot_version
metric_key
segment_key               // all | first_time | returning | other approved segment
value_json                 // already aggregated, threshold-safe
unique_member_count_internal
sample_band
coverage_json
confidence_state
suppression_reason
generated_at
```

Merchant APIs return only `value_json`, sample band, coverage, confidence and
safe metadata. Internal counts remain service-only unless the configured exact
count threshold permits disclosure.

### 10.4 `merchant_discovery_opportunities`

```text
id
partner_id
rule_key
rule_version
goal
evidence_snapshot_refs
evidence_summary_json
recommended_action
suggested_voucher_fields_json null
status
dismissal_reason null
linked_voucher_template_id null
created_at
expires_at
resolved_at null
resolution_json null
```

Suggested voucher fields are untrusted draft inputs and must pass the same
validation as a manually created voucher.

### 10.5 Public merchant response

The existing public merchant response may add:

```ts
type MerchantMedia = {
  id: string;
  kind: "business" | "product";
  imageUrl: string;
  thumbnailUrl: string;
  title: string | null;
  altText: string;
};

type ApprovedCustomerPhoto = {
  id: string;
  thumbnailUrl: string;
  displayUrl: string;
  itemLabel: string | null;
  altText: string;
};
```

It never returns source keys, moderation notes, contributor ids, raw item
labels, prices or inventory as part of these media fields.

---

## 11. Merchant API contracts

Proposed Akiba-Platform endpoints:

```text
GET    /api/merchant/discovery/overview?window=&branch=
GET    /api/merchant/discovery/items?window=&branch=&cursor=
GET    /api/merchant/discovery/visit-fit?window=&branch=
GET    /api/merchant/discovery/private-feedback?window=&branch=
GET    /api/merchant/discovery/photos/status?window=&branch=
GET    /api/merchant/discovery/opportunities?status=&cursor=
POST   /api/merchant/discovery/opportunities/:id/dismiss
POST   /api/merchant/discovery/opportunities/:id/voucher-draft
GET    /api/merchant/discovery/settings
PATCH  /api/merchant/discovery/settings

GET    /api/merchant/media
POST   /api/merchant/media/upload-intent
POST   /api/merchant/media/:mediaId/complete
PATCH  /api/merchant/media/:mediaId
POST   /api/merchant/media/reorder
POST   /api/merchant/media/:mediaId/publish
DELETE /api/merchant/media/:mediaId

POST   /api/merchant/discovery/customer-photos/:photoId/report
POST   /api/merchant/discovery/items/:itemId/report
```

All mutation routes:

- authenticate the merchant user;
- derive `partner_id` from the server session;
- enforce endpoint-specific permissions: owner/manager for media and
  opportunity mutations, owner for participation settings, and staff only for
  reporting where the role matrix permits it;
- validate state transitions and same-partner links;
- rate limit writes;
- accept an idempotency key where retry can duplicate an action;
- write actor, action, target and safe before/after metadata to the audit log;
- never accept a public URL or storage key that was not issued by the media
  pipeline.

Insight endpoints read precomputed snapshots. They do not scan raw customer
responses at request time.

---

## 12. Privacy, security and integrity

### 12.1 Privacy boundary

- Minimum merchant-private cohort: five unique eligible members.
- No customer name, email, phone, wallet, Hub user id, contribution id,
  earning-event id, payment reference or exact visit timestamp.
- No raw customer-entered item labels.
- No individual response drill-down.
- No filters that reduce a cohort below threshold.
- No differencing attack through overlapping filters; snapshot/filter
  combinations are reviewed and rate limited.
- Withdrawals, reversals, disputes, suppressions and merchant staff/test
  exclusions are reflected in the next snapshot.

### 12.2 Security

- Merchant endpoints require authenticated partner membership.
- RLS denies merchant roles direct reads of raw earning events, contributions,
  item mentions and customer-photo tables.
- Service roles generate snapshots and public projections.
- Upload intents bind partner, media id, file count, size and short expiry.
- Image workers enforce decode time, memory, dimension and pixel limits.
- Original uploads are private; public delivery is derivative-only.
- User-supplied titles/alt text are length-limited, escaped and policy checked.
- Opportunity actions and setting/media mutations are auditable.

### 12.3 Integrity

- One member/merchant/local-day contribution per aggregate.
- Verified event status is rechecked during snapshot generation.
- Merchant staff and known test accounts are excluded for their own merchant.
- Same-image and near-duplicate detection prevents media/gallery gaming.
- Merchant media never enters customer proof calculations.
- Reported items cannot become authoritative purchases.
- Opportunities use versioned rules and immutable evidence references.
- Akiba Operations can suppress a media item, insight snapshot or opportunity
  with a reason and audit record.

---

## 13. UX states and accessibility

Every merchant intelligence surface defines:

- loading skeleton;
- qualified result;
- collecting/under-threshold state;
- source-unavailable state;
- merchant-paused state;
- retryable error;
- permission-denied state.

Do not render empty charts. A collecting state explains what evidence is
needed without revealing the current exact suppressed count.

Requirements:

- complete media upload, reorder, edit and removal at 320px without horizontal
  scrolling;
- every control has a visible label or accessible name;
- touch targets are at least 44×44 CSS pixels;
- keyboard alternatives exist for drag reordering;
- destructive removal requires confirmation and provides recovery where
  feasible;
- upload progress and errors are announced without stealing focus;
- charts have adjacent text summaries and accessible tabular alternatives;
- insight is never conveyed by colour alone;
- focus remains visible and is restored after dialogs;
- reduced-motion and 200% zoom remain usable;
- date/branch filters preserve context and announce refreshed results.

---

## 14. Analytics and audit events

Product analytics must not include raw responses or customer identifiers.

```text
merchant_discovery_overview_view
merchant_discovery_window_change
merchant_discovery_branch_change
merchant_insight_explanation_open
merchant_item_insight_view
merchant_private_feedback_view
merchant_photo_status_view
merchant_media_upload_started
merchant_media_upload_completed
merchant_media_published
merchant_media_removed
merchant_customer_photo_reported
merchant_item_reported
merchant_opportunity_view
merchant_opportunity_dismissed
merchant_opportunity_voucher_draft_created
merchant_opportunity_voucher_published
merchant_opportunity_resolved
```

Event properties may include partner id, role, window, branch-present boolean,
metric key, opportunity rule key/version and outcome. They must not include
raw item input, private feedback, media captions, customer ids or exact
suppressed counts.

Separate immutable audit events cover permission-sensitive mutations:

- discovery setting changed;
- media created/edited/reordered/published/removed;
- report submitted;
- opportunity dismissed;
- voucher draft created from opportunity.

---

## 15. Service levels

- Merchant media published to Hub: within 5 minutes after publish.
- Merchant media removal from Hub/CDN: p95 within 15 minutes.
- Verified customer-photo report acknowledgement: immediate case id.
- Merchant insight snapshot refresh: within 24 hours, clearly labelled.
- Reversal/withdrawal/suppression reflected in merchant insights: p95 within
  24 hours.
- Opportunity generation after snapshot refresh: within 2 hours.
- Dashboard source outage must not remove ordinary merchant settings, orders or
  voucher access.

---

## 16. Rollout plan

### Stage M0 — contracts and shadow snapshots

- Finalise merchant roles and permission matrix.
- Implement versioned merchant insight snapshots.
- Produce shadow metrics and compare them with audited source queries.
- Confirm privacy thresholds, retention and consent scope.
- Add feature flags per merchant and per capability.

### Stage M1 — merchant media pilot

- Launch private upload/processing and merchant preview.
- Publish `merchantMedia` to a small merchant cohort.
- Validate Hub source labels, processing, ordering, removal and CDN purge.
- Keep customer-photo controls read-only.

### Stage M2 — read-only intelligence pilot

- Launch Overview, What customers choose, Visit fit and Private feedback.
- No automated opportunities yet.
- Validate comprehension: merchants must distinguish reported, recommended and
  purchased evidence.
- Audit suppression and segment thresholds.

### Stage M3 — opportunity recommendations

- Enable a small reviewed rule set.
- Require human review for every rule before cohort enablement.
- Allow draft voucher creation through the existing workflow.
- Measure adoption and false/irrelevant recommendation rate.

### Stage M4 — outcome loop

- Link published opportunities to voucher redemption and verified-repeat
  outcomes.
- Show observational result summaries.
- Expand only after Data approves measurement quality.

Each stage has an independent kill switch. Merchant media can remain available
when intelligence is paused; verified proof can remain public when opportunity
generation is paused.

---

## 17. Acceptance criteria

### 17.1 Media

- An authorised owner or manager can upload, preview, caption, order, publish
  and remove merchant media.
- Staff cannot mutate media without an explicit future permission.
- Product linkage cannot cross partners.
- Originals and non-published derivatives are not publicly readable.
- Hub labels merchant media `From the business`.
- Merchant media cannot qualify or reorder `Verified visits`.
- Removing published media clears the public projection within the SLO.
- A merchant can report but cannot moderate a customer photo.

### 17.2 Intelligence correctness

- Skip is never counted as a negative recommendation.
- Reported, explicitly recommended and authoritatively purchased items remain
  separate in storage, APIs and UI copy.
- Negative reasons remain private and aggregate-only.
- Party size `6+` never enters per-person spend.
- Miles never become a money proxy.
- First-time/returning classification uses verified event history.
- Reversed, disputed, withdrawn and suppressed evidence disappears on refresh.
- One member cannot inflate a metric through same-day repeat events or multiple
  photos.
- Every visible trend has two independently qualified periods.
- Every visible segment has its own qualified cohort.

### 17.3 Privacy and authorisation

- No merchant response contains a customer identity or raw response.
- No filter/API combination returns an under-threshold cohort.
- A merchant user cannot access another partner's media, settings, insight or
  opportunities by changing an id.
- All mutations are audited.
- Merchant users cannot invoke admin moderation transitions.

### 17.4 Opportunities

- Every opportunity names its evidence, window, confidence and trade-off.
- Operational problems do not default to promotional discounts.
- No opportunity is created from a single response or under-threshold segment.
- Voucher actions create drafts and never auto-publish.
- Suggested fields pass existing voucher validation and partner ownership
  checks.
- Outcome copy distinguishes observation from causal lift.

### 17.5 Resilience and accessibility

- One failed insight section does not take down the dashboard.
- Orders, ordinary settings and voucher management remain available during an
  intelligence outage.
- Media actions and insight navigation work by keyboard and touch.
- All charts have readable text/table equivalents.
- Loading, empty, collecting, permission and failure states are distinguishable
  without relying on colour.

---

## 18. Implementation map

### Akiba-Platform merchant application

- Customer discovery navigation and overview.
- Media library and upload workflow.
- Insight pages and filters.
- Settings and report flows.
- Opportunity review, dismissal and voucher-draft handoff.
- Partner-role authorization and audit log.

### Hub

- Continue producing verified earning/contribution evidence.
- Render the two provenance-labelled photo tabs and the conditional public
  `Locations` profile tab.
- Consume only `merchantMedia` and individually approved
  `approvedCustomerPhotos` public projections; the first approved photo is
  immediately eligible for the verified gallery.
- Emit merchant-page and gallery engagement events for aggregate attribution.

### Shared data/services

- Merchant media private/source and derivative storage.
- Media processing and policy pipeline.
- Versioned merchant insight snapshots.
- Versioned opportunity rules and outcome writer.
- Public merchant-media projection.
- Withdrawal, reversal, suppression and CDN invalidation propagation.

### Admin Operations

- Customer-photo and generated-item queues.
- Merchant-media suppression and appeal workflow.
- Snapshot/opportunity suppression with reason.
- Integrity monitoring and audit search.

---

## 19. Launch decisions still required

1. **Product:** final merchant navigation name, copy and opportunity owners.
2. **Privacy/Compliance:** private cohort threshold, exact-count threshold,
   retention, merchant media policy and report/takedown SLA.
3. **Data:** confidence states, materiality thresholds, prior-period logic and
   outcome methodology.
4. **Akiba-Platform:** canonical merchant app/repository, role permissions,
   media pipeline and public projection contract.
5. **Merchant Success:** pilot cohort, onboarding and interpretation guidance.
6. **Operations:** media escalation, customer-photo reports, appeals and
   suppression staffing.
7. **Voucher owner:** supported draft fields and publish permissions.

Until these decisions are approved, missing contracts fail closed: merchant
media stays absent, under-threshold intelligence stays hidden and no
opportunity is produced. Ordinary merchant discovery, orders and vouchers must
continue to function.
