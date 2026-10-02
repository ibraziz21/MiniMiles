# Spec: Post-Visit Store Mission

**Primary surface:** `packages/hub-page`
**Supporting surfaces:** Akiba-Platform merchant dashboard (insight panel,
merchant media and draft vouchers), `packages/admin-dashboard` (template
curation, Phase B moderation), Akiba Platform shared Supabase schema
**Status:** Draft for review
**Governing document:** `akiba-demand-intelligence-platform.md` (DIP) — this
spec implements the `hub-page` half described in DIP §3.4 and §12.1. All `§`
references below are to that document.

---

## 0. Product truth and outcome

`hub-page` owns the only moment in the system where a member is provably at a
business with money spent: the Pass scan at the till. Today that moment ends in
a Miles credit and nothing else. `sendPurchaseEvent` fires, the Platform ledger
records a `merchant_award`, `produceMilesEarnedNotification` pushes a number,
and the richest context Akiba will ever hold is discarded.

DIP §12.1 states the consequence plainly: *"hub-page stays the same" is
equivalent to "DIP never advances past stated preference."* This spec is the
smallest change that moves it past that line.

The outcome:

> A member who has just paid at an Akiba merchant is asked three questions
> about what they actually bought. Because Akiba watched the payment happen,
> the answers carry proven presence — DIP §3.5 tier 3, *"full reward, full
> weight, sellable"* — without asking the member to prove anything. The answers
> return to members as social proof on the merchant page, and to the merchant
> as a priced, pre-validated voucher draft.

### 0.1 Why the trigger is the whole design

An earlier shape of this feature asked members *"have you been here?"*. That
version is **DIP §3.5 tier 0** — self-declared, *"proves nothing, excluded from
sellable data."* Attach-triggered is **tier 3**. Same questions, same UI,
opposite ends of the presence table.

Three subsystems disappear with the trigger change, and none of them need to be
built:

| Dropped | Why it existed | Why it's unnecessary |
|---|---|---|
| Self-report grading against `activity.ts` | verify claimed visits | there is no claim |
| Asymmetric reward shaping by answer | stop members falsely claiming to be regulars | nothing to falsify |
| Menu-decoy question as truth check | detect answers from people who were never there | presence is already proven |

The decoy survives only as an ordinary attention check (§8), not as the
mechanism the feature's integrity rests on.

---

## 1. Non-negotiable principles

1. **Never ask what the system already knows.** Visit, merchant, amount, visit
   count and prior redemption history are all on record. Questions spend the
   scarcest asset in DIP — finite member attention (§3.7) — and must be spent
   only on what cannot be observed.
2. **Presence is never claimed, only observed.** No question in this mission may
   ask the member to assert that they were somewhere. The trigger asserts it.
3. **The reward is redeemable only by returning and scanning.** Miles are not
   paid for the answer (§4.1).
4. **No member sees a merchant's aggregate before answering that merchant's
   mission** (§5.1). This is a data-integrity rule, not a UX preference.
5. **Every mint has a named payer** — DIP §6 rule 1. The merchant funds this;
   without merchant funding the mission does not run.
6. **What gets sold is the weighted dataset, never the raw one** — DIP §7.

---

## 2. Trigger contract

### 2.1 Qualifying events

The mission is offered on tier-3 events only — the merchant's own authenticated
device produced them:

| Event | Source | Module |
|---|---|---|
| Pass scan award at till | Platform miles ledger, credit with `partner_id` | `lib/akiba/activity.ts` (`merchant_award`) |
| Voucher redemption | `issued_vouchers.redeemed_at`, `AKV1` scan | `lib/akiba/internal-events.ts` (`voucher_redeemed`) |
| Purchase event completion | order lifecycle | `lib/akiba/purchase-events.ts` (`sendPurchaseEvent`) |

Tier 0–2 events (GPS, self-declaration, static merchant QR, a bare Pass
presentation with no award) **never** trigger a mission.

A `purchase_reversed` event received after a mission was offered voids the
mission and any unclaimed offer.

### 2.2 Timing window

| Parameter | Value | Rationale |
|---|---|---|
| Delay after attach | 20–60 min | the member has consumed the thing; no pressure at the counter |
| Expiry | same day, 23:59 local | beyond that the answer is reconstruction, not recall |
| Delivery | web push via `lib/akiba/milesEarnedNotification.ts`, plus an in-app entry point on `/pass` and home | the notification rail already exists |

This is a **deliberate deviation from DIP §3.6**, which sequences the mission
*before* payment. Post-hoc trades a little signal strength for no race with the
cashier, no added friction at the till, and no social pressure while the member
is standing at the counter. The timing window is what keeps the trade
acceptable, and is therefore the parameter to tune first.

Copy framing is load-bearing: *"Thanks for shopping at Kilifi Bakers"*, never
*"We noticed you visited."* Same fact, and only one of them reads as
surveillance.

### 2.3 Rate limiting

Trigger on **visit 1, 3 and 10** at a given merchant, then at most once per 90
days. A daily regular at one café is not asked daily. Visit count comes from
that member's `partner_id` history in `activity.ts`.

---

## 3. The mission

Three questions, ~20 seconds, matching the DIP §3.4 Store Mission budget. One
reward per completed set, never per card (DIP §6 rule 5).

### 3.1 Question set by visit count

The system knows which visit this is, so the same component yields three
different datasets at no extra elicitation cost:

| Visit | Q1 | Merchant learns |
|---|---|---|
| 1st | What made you come in today? | acquisition driver |
| 3rd | What did you like most? | the item to build a voucher on |
| 10th+ | What keeps you coming back? | retention driver |

### 3.2 Q2 — the item

Picker over the merchant's Akiba-Platform catalogue where one exists;
category-level otherwise. Per DIP §3.8, SKU
depth **only** where the merchant supplied a catalogue.

Free text is excluded. It does not pool across merchants — which is the entire
reason templates exist (DIP §3.7 rule 1) — and it invites PII.

### 3.3 Q3 — the price point

> *"Would you spend ◈400 on mandazi + chai here?"*

DIP §6 rule 2 wants Decisions priced in Miles wherever possible: this does
preference elicitation and price discovery for
`spend_voucher_templates.miles_cost` in one card, and a budget-constrained
answer is a credible answer. Q3 is what makes §6's merchant panel able to emit a
*priced* voucher draft rather than a bar chart.

Where a trade-off framing is available it is preferred over binary yes/no (DIP
§6 rule 3).

### 3.4 Q4 — advocacy (Phase A)

> *Did you post about it?* — Yes, on Instagram · Yes, on TikTok · No

One tap, **no link collected in Phase A**. This yields an organic advocacy rate
per merchant with no fraud incentive, no moderation queue, no account linking
and no new consent category. See Appendix A for why link collection is phased
separately.

Commercially this question is not a minor addition: demand data is bought from a
merchant's research or stocking budget, which is small and unfamiliar. Advocacy
and reach data is bought from their marketing budget, which is larger, already
allocated, and spent monthly without deliberation.

It is also a different axis rather than a new rung on DIP §4's ladder — every
rung there measures demand; this measures amplification.

---

## 4. Reward

### 4.1 Shape

The reward is **an offer redeemable only at that merchant, only by scanning the
Pass.** The member does not pay Miles for it — they pay with a visit.

| Property | Consequence |
|---|---|
| Merchant-funded | satisfies DIP §6 rule 1 (named payer) |
| Nothing mints until redemption | cost incurred only on success |
| Redemption is a tier-3 attach | the reward mechanism manufactures the system's highest-grade data |
| Redeemed or not within window | populates `resolution` (DIP §3.3) |

Paying flat Miles for completing the mission would rebuild `daily_checkin` with
extra steps — the Akiba-funded, learns-nothing faucet DIP §2 exists to indict.

A small flat base (DIP §3.4's own anchor is ◈5 for a three-question mission) may
sit under the offer to acknowledge completion. It is identical on every answer
path.

### 4.2 Offer selection

Offer type is chosen from **observed history**, not from anything the member
says:

| Observed | Offer | Merchant is buying |
|---|---|---|
| 1st visit | come-back offer | conversion of a trial |
| 3rd–9th visit | item-matched offer on their stated favourite | frequency |
| 10th+ visit | higher-value or bundle offer | retention of a known regular |

`lib/akiba/nextReward.ts` is the prior art to reuse — DIP §12.1 names it
explicitly as a capability not to duplicate.

### 4.3 Issuance

Through the existing path: `spend_voucher_templates` →
`app/api/shop/vouchers/issue/route.ts` → `AKV1` redeem token →
`app/api/shop/vouchers/redeem/route.ts`. No new issuance rail.

### 4.4 Flywheel property

The attach that *triggers* a mission and the attach that *redeems* its offer are
the same mechanism. Visit → mission → offer → next visit → mission. The feature
compounds on one rail.

---

## 5. Member-facing component — merchant detail page

New component on `app/merchants/[slug]/page.tsx`, alongside `VoucherCard` and
`OperatingBadges`.

> **Most loved here** · mandazi · chai · samosa

### 5.1 The answer gate

**A member who has not completed this merchant's mission does not see its
aggregate.**

Displaying results to future respondents anchors them; responses stop being
independent samples and become an echo of the first cohort. The failure is
silent and unrecoverable — it surfaces months later as a voucher built on the
data underperforming.

The gate is also the engagement mechanic: *answer first, then see what everyone
else said.* Curiosity outperforms ◈5, costs nothing, and is the reason a member
takes a second mission. This component is the payoff screen for §3.

Without it, the mission is extraction and yield decays as novelty fades; with
it, answering visibly changes the app — the *"you asked for this"* payoff DIP
§3.2 describes as the served-cell experience.

### 5.2 Display rules

1. **Ordinal ranks, never percentages.** Avoids small-n false precision, and
   avoids the two surfaces publicly disagreeing when members see raw figures and
   merchants see weighted ones (DIP §7).
2. **Hard n-threshold before the component renders at all.** Below it, nothing
   is shown — not a partial result. This is DIP open question #3 in miniature;
   below threshold the display is both misleading and a re-identification risk
   at a small merchant. Proposed: n ≥ 25 to display, higher to sell (§11).
3. **Merchant toggle is all-or-nothing.** A merchant may hide the component
   entirely; they may not suppress individual items. Cherry-picking makes it
   advertising, members work that out quickly, and it stops driving anything.

### 5.3 Relationship to merchant-page photos

The merchant page's photo surface is specified by
`verified-discovery-acquisition-v1-spec.md` §7.7 and stays provenance-separated:

- `Verified visits` contains anonymous positive structured recommendations
  from active verified purchases plus approved, moderated post-purchase photos;
- `From the business` contains merchant-authored business and product media.

Merchant media is not part of this mission's answer gate and may remain visible
before a member answers. It never counts as a response, recommendation or
verified-customer signal. The verified tab may show the first eligible positive
recommendation and first approved photo immediately; it does not expose the
answer-gated aggregate described in §5.1.

---

## 6. Merchant-facing panel

Lives in the canonical Akiba-Platform merchant dashboard, not Hub.
Single-merchant, first-party data about that merchant's own customers. The
in-repository `packages/merchant-dashboard` is not an implementation target
unless platform ownership is explicitly changed.

The canonical merchant-side information architecture, calculations, privacy
thresholds, merchant media workflow and opportunity lifecycle are specified in
`merchant-discovery-media-and-intelligence-spec.md`. The examples below define
the mission-specific intent and do not override that contract.

### 6.1 The report

> **312 responses · Nyali**
> Most-named favourite: **mandazi** (34%) — your catalogue lists it third
> **61%** would spend ◈400 on mandazi + chai
> **8%** posted about you — Nyali café average is 3%
> Offer conversion: **23%** redeemed within 14 days, at ◈8 each

### 6.2 Draft voucher, not a chart

A bar chart makes a merchant think. A pre-filled draft makes them click.

> **Suggested voucher** · mandazi + chai · ◈400
> 34% named it their favourite · 61% would spend ◈400
> You have no voucher for it → **[Create draft]**

Writes a draft `spend_voucher_templates` row through the existing issue path.
`nextReward.ts` supplies the recommendation layer.

### 6.3 The resolution loop

The suggestion is a prediction; the voucher tests it; redemption resolves it.
That populates `resolution` — the field DIP §3.3 calls the only one that makes
the system *learn* rather than accumulate — and each cycle improves the next
suggestion. Several quarters in, *"Akiba's voucher suggestions outperform what
merchants pick themselves"* becomes a claim with receipts.

### 6.4 This is not the Demand Snapshot

DIP §12.4 places the Demand Snapshot at step 10 and leaves the merchant
dashboard untouched through step 9. This panel pulls a merchant-facing surface forward
deliberately, and the distinction must be preserved in the build:

| | This panel | Demand Snapshot (§5.4) |
|---|---|---|
| Scope | one merchant, their own customers | cross-merchant, cell-level |
| Consent complexity | first-party | DIP §8's hardest questions |
| Aggregation threshold | display threshold only | open question #3 |

Keeping them separate is what stops the shippable one inheriting the hard one's
blockers.

---

## 7. Data contract

Per DIP §3.3 / §3.3.2, with values fixed for this surface:

```
Decision
  decision_type    trade_off | price_point   (never binary yes/no where avoidable)
  origin           contextual
  context          store_mission             (explicit, never derived from route)
  author           partner_id
  hypothesis       pre-registered, e.g. "mandazi is the top-named item and
                   ≥50% will accept ◈400 for mandazi + chai"
  population       members with a tier-3 attach at this partner_id
  budget           max responses purchased by the merchant
  expiration       same-day per instance; campaign-level per budget
  resolution       written back from voucher redemption (§6.3)

DecisionResponse
  presence_tier        3
  discovery_context    pass
  merchant_context     partner_id
  renderer             post_visit_mission
  visit_index          1 | 3 | 10+           (drives the question set, §3.1)
  consent_version      DIP-scope version (§9)
  quality_flags        attention check, latency floor
  weight               presence_tier × user quality
  sellable             false on failed checks or uncovered consent
```

`budget` doubles as the stopping rule: when a merchant's purchased responses are
exhausted, the mission stops triggering for that partner. This prevents the
notification rail flooding.

---

## 8. Data quality and anti-gaming

Foundation is `lib/blacklist.ts`, `lib/pollEligibility.ts`,
`lib/pollProfileGate.ts` per DIP §7.

- **Attention check** — a repeated card scored for consistency. Inconsistent
  sessions drop from the sellable dataset.
- **Latency floor** — sub-400ms on a card with text is not a read.
- **Failed checks still pay the member** (DIP §7, explicit). Never punish a
  member for a quality signal you wanted anyway.
- **Natural volume cap.** Response volume is bounded by attach volume, which is
  bounded by network size. The feature cannot run away in a thin cell — a
  stronger property than a daily cap.

### 8.1 Known cost: slow start

Coverage is capped by attach volume, so in early Mombasa response counts will be
small and §5.2's n-threshold will bite. Merchant panels will be empty for a
period. This is self-correcting as the network grows, but merchants must be told
at sale rather than discovering it.

### 8.2 Known cost: no awareness instrument

The tier-0 version could ask *"never heard of it"* and feed MAC's brand
familiarity term (DIP §5.1). This version cannot — it only reaches people who
already visited. MAC's familiarity term therefore still has no instrument. That
is separate work, not this feature's job, and should not be solved by weakening
the trigger.

---

## 9. Consent — hard dependency

Existing consent is `POLL_TERMS_VERSION = "akiba-verified-insights-v1"`, scoped
to **polls**. This feature:

- derives a profile from attach and redemption behaviour,
- publishes a member-derived aggregate on a public merchant page,
- sells that aggregate to the merchant.

All three are new purposes under Kenya's Data Protection Act 2019 and Nigeria's
NDPA 2023 purpose-limitation rules. The DIP-scope consent version (DIP §12.4
step 3, both `react-app` and `hub-page`) **must land before the first response
is collected.** `consent_version` per response is the only thing that later
separates usable data from unusable; several thousand responses gathered under
the wrong scope are discarded, not retro-fitted.

---

## 10. Build order

| # | Item | Package | Blocked by |
|---|---|---|---|
| 1 | DIP consent scope version | `react-app` + `hub-page` | — |
| 2 | Decision + DecisionResponse tables | Platform schema | 1 |
| 3 | Trigger off attach events + timing window | `hub-page` | 2 |
| 4 | Mission UI (3 questions, visit-count sets) | `hub-page` | 3 |
| 5 | Offer issuance via existing `AKV1` path | `hub-page` | 4 |
| 6 | Answer-gated component on merchant page | `hub-page` | 4 |
| 7 | Merchant panel + draft voucher | Akiba-Platform | 4 |
| 8 | Resolution writer (redemption → `resolution`) | `hub-page` emits | 5, 7 |

Steps 1–5 are the shippable core. 6 is what sustains yield. 7–8 are what make it
a product rather than a dataset.

---

## 11. Open questions

1. **n-threshold values** — display vs sellable. Interacts with DIP open
   question #3.
2. **Offer funding source** — merchant subscription allowance vs separately
   bought campaign credits. DIP open question #9; changes pricing, not the build.
3. **Timing window** — 20–60 min is a starting hypothesis and should be tested
   against completion rate and answer quality.
4. **Base payment** — whether a flat ◈5 under the offer is needed at all, or
   whether the offer alone is sufficient motivation.
5. **Visit-count thresholds** — 1 / 3 / 10 is an assumption; actual repeat
   distributions should set it.
6. **Template curation owner** — who maintains the question templates as
   categories expand (DIP open question #11).

---

## Appendix A: Phase B — social post collection

**Not in scope for the first release.** Requirements captured so the decision
stays visible.

Phase A (§3.4) measures advocacy. Phase B would collect and republish the posts
themselves on the merchant page. It is worth doing and is the only part of this
design that acquires *new* members rather than measuring existing ones — but it
drags in four problems the mission does not have:

1. **A URL proves nothing.** Anyone can paste a stranger's viral video. Real
   verification means one-time social account linking, then oEmbed resolution
   checking that the author handle matches. That is an account-linking flow that
   does not currently exist.
2. **Do not pay Miles for posts.** Paid advocacy is not advocacy — the signal is
   the first casualty. There is a legal edge: compensated posts require
   disclosure under both platforms' rules and under Kenyan and Nigerian
   advertising standards, and DIP §6 rule 1 sharpens rather than softens this —
   a merchant-funded post reward is unambiguously paid promotion. Pay in
   **status** instead: featured placement, contributor badge, visible reach.
3. **Akiba becomes a publisher.** Republishing customer content on a paying
   merchant's page eventually surfaces something defamatory, off-brand or
   hostile. Requires a review queue (`admin-dashboard`, per DIP §3.7 rule 4) and
   the same all-or-nothing merchant toggle as §5.2.
4. **Do not embed players.** Third-party IG/TikTok embeds mean their scripts,
   their tracking, CSP work and serious page weight on a mobile-first app where
   members pay per megabyte. Store the URL, pull thumbnail and handle via oEmbed
   at submission, render a light card that links out.

Plus a **separate** consent category: linking an Akiba identity to a public
social handle is not covered by the §9 scope bump and needs its own explicit,
revocable opt-in — unlinking pulls the posts down.

Expect most merchants to have no posts. The section needs the same n-threshold
treatment as §5.2 or it reads as a dead feature on every page it appears on.

Account linking, verification, a moderation queue and a new consent category
together are larger than the post-visit mission itself. Phase B must not block
Phase A.
