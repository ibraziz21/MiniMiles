# Akiba Mombasa GTM — v3: The Bridge Model

*24 August 2026*

---

## The model

> Akiba is not a merchant-to-merchant loyalty clearing system. It is a consumer rewards network. Participating merchants gain access to the network by allowing consumers to earn Akiba through purchases, while merchants independently fund offers and vouchers when they want to attract or retain Akiba users. Miles are an internal engagement unit, not a monetary claim against the merchant that issued them.

Mechanically: **KES 500/month** entitles a merchant to issue up to **2,500 Miles/month**, earned at **1 Mile per KES 100** of consumer spend — covering KES 250,000/month of attached spend. Consumers burn Miles on **merchant-funded offers**, repeatable or one-time, at the redeeming merchant's discretion. Akiba carries no per-Mile liability on the voucher marketplace.

The consumer architecture is **needs → wants**: earn from spending you couldn't realistically avoid, burn on discretionary spending. Redemption merchants participate because they're competing for exactly that discretionary spend.

---

## Why bridges instead of phases

A phase describes *where you are*. A bridge describes *what carries you to the next place, and what happens if it doesn't hold.*

That distinction matters here because the original plan's failure mode was assuming network effects appear on schedule. They don't. Each stage of Akiba has a specific mechanism that produces the next stage, and every one of those mechanisms can fail independently. Reorganising around bridges forces three things the phase model allowed you to skip:

1. **Every stage must name what is carrying merchant-perceived value *right now*** — not what will carry it once the network is dense.
2. **Every bridge needs a gate** — an explicit condition that says you may cross. Without gates, you cross early because it feels like momentum, and arrive with neither side of the network working.
3. **Bridges expire.** Content, subsidy, and founder attention all have carrying capacities. When a bridge's capacity is exceeded before the next mechanism is live, you fall in the gap. That gap is where most of the risk in this plan lives.

Each bridge below has: **the load** it must carry, the **mechanisms**, **what breaks it**, the **gate** to the next bridge, and the **one number** that tells you it's holding.

---

# Bridge 1 · Cold start → Early value

**Months 0–3. The merchant has paid and the network is empty.**

### The load

A merchant who pays KES 250–500/month in a market with almost no Akiba consumers must receive value that is **independent of network density**, and must receive it fast enough to renew.

Nothing about the network can do this yet. The formula from the cold-start problem is unforgiving:

> Merchant value ≈ (share of that merchant's customers who are Akiba-active) × (preference lift from earning) × (merchant margin)

At 2% local penetration the first term annihilates the product. So Bridge 1 is carried entirely by things that work at *any* density.

### Mechanisms

| Mechanism | What it delivers | Density-independent? |
|---|---|---|
| **Subsidised entry** (personal political relationships, ~50% of fee, 50–100 MSMEs) | Lowers the cost of patience — buys runway, not value | Yes |
| **Attributable content** (Shaif, Bai — 7–10 merchants/week) | Visible demand creation, with measurable claims | Yes |
| **Campaign recommendations** | Merchant-attributable results from their own customer base | Yes |
| **Redemption inventory** ← *addition to your list* | Nothing yet — but must be built here to be ready for Bridge 2 | Built here, pays off later |

**On content — the correction matters.** Views are a vanity metric and no merchant renews on them. Every featured merchant needs a measurable call to action: *scan this QR, claim this offer, earn today.* Then the merchant sees **380 claims, 140 scans, 37 first-time customers** instead of 8,000 views. That's the difference between content as marketing and content as proof.

There's a second-order benefit worth planning for deliberately: attributable content produces **the first merchant-ROI dataset Akiba owns.** Which offer types pulled, at which discount depths, in which categories, at which times of day. That dataset is the seed corn for campaign recommendations in Bridge 4. Content isn't only a bootstrap — instrument it properly and it's the beginning of the data moat.

**On redemption inventory.** This belongs in Bridge 1 even though nothing burns yet, because burn attractiveness must *lead* earn density, never lag it. A consumer who accumulates Miles and finds nothing worth having has learned something you cannot un-teach — and they learned it *because* you succeeded on the earn side. Target catalogue before consumer acquisition opens: one aspirational anchor, 3–4 repeatable mid-tier offers, airtime/data, and a low-balance game tier.

The **burn ladder** guarantees there is always something achievable at every balance:

| Balance | Options | Purpose |
|---|---|---|
| Low (< ~100 Miles) | Games, raffles, micro-rewards | Nothing is ever "not enough" |
| Medium | Airtime, data, coffee, food | Reliable, universal, always available |
| High | Vouchers, experiences, electronics | The reason to keep earning |

### What breaks it

**The synchronised subsidy cliff.** This is the sharpest risk in Bridge 1 and it is a marketplace risk, not a SaaS risk. If 75 merchants onboard in September at KES 250 and all step to KES 500 in December, they all make the renewal decision in the same week — at the deepest point of the cold-start valley, before consumer habit has formed. Lose 30 and you haven't lost 30 subscriptions; you've lost the density that made the remaining 45 worth having. Marketplace businesses are far more sensitive to synchronised churn than SaaS businesses, because the churn is self-reinforcing.

**The fix is staggered onboarding, not tapered pricing.** 15–20 merchants per fortnight spreads renewals automatically:

| Cohort | Onboards | Renews |
|---|---|---|
| 1 | Week 1 | Week 13 |
| 2 | Week 3 | Week 15 |
| 3 | Week 5 | Week 17 |
| 4 | Week 7 | Week 19 |
| 5 | Week 9 | Week 21 |

Three benefits, not one: renewals spread; onboarding improves between cohorts; and each cohort becomes a natural experiment whose lessons compound into the next. Cohort 4 should convert better than cohort 1, and if it doesn't, that's a finding.

**Content's carrying capacity.** At 7–10 merchants/week, featuring each merchant roughly quarterly caps out at:

| Output | Every 2 months | Every 3 months | Every 4 months |
|---|---|---|---|
| 7/week (30/mo) | 61 merchants | 91 merchants | 121 merchants |
| 10/week (43/mo) | 87 merchants | 130 merchants | 173 merchants |

**Call the ceiling ~120 merchants.** Beyond that, featuring becomes annual and the benefit evaporates. Content is not a scalable merchant benefit — it is a market bootstrap mechanism, and the GTM should say so plainly:

> Content carries merchant-perceived value until network effects and campaign tooling become the dominant reasons to remain on Akiba.

That honesty has an operational consequence: **campaign tooling must be live and demonstrably working before you exceed ~120 merchants.** If it isn't, merchant 121 onwards has nothing carrying them, and the churn shows up two months later when you've already committed to the bigger footprint.

One related trap: the plan currently disclaims featuring as "not marketing as part of the subscription." Merchants will experience it as part of the subscription regardless, and will feel demoted when the rotation passes them. Define it as a rotating benefit with a stated frequency rather than disclaiming it and then having it stop.

**Merchant belief, which is the real currency here.** You're right that a merchant does not buy on an LTV calculation. They buy because they believe *this could bring me customers* — and content works less because of the video than because it demonstrates Akiba is actively trying to create demand rather than charging rent on software. That reframing is correct and it should shape everything in Bridge 1.

It cuts both ways, though, and that's worth planning for. Belief is cheap to build and cheap to destroy, and in a concentrated cohort it is **contagious**. Seventy-five merchants on the same few streets in Majengo talk to each other. One merchant loudly concluding "they just take your 500" travels faster than any campaign result. So belief is an asset in Bridge 1 *and* the mechanism by which the subsidy cliff could cascade — which argues for measuring merchant sentiment as a live indicator, not just renewal rate. By the time renewal rate moves, sentiment moved six weeks earlier.

### The gate to Bridge 2

Do not open consumer acquisition until, in the target catchment:

- **60+ live merchants** in a single walkable area, with a category mix weighted to high-margin discretionary-repeat (barber, café, kinyozi, pharmacy, restaurant)
- **Burn ladder stocked at all three tiers**, including at least one aspirational anchor
- **Cohort 1 renewal ≥ 70%** at full price
- **Median days from merchant signup to first consumer scan under 21**

### The number

**Merchant renewal at first full-price cohort.** Everything in Bridge 1 exists to make that number good.

---

# Bridge 2 · Early value → Density

**Months 3–9. Merchants are live; consumers must arrive and form a habit.**

### The load

Two thresholds must be crossed *simultaneously in one place*: enough earn density that Miles accumulate noticeably, and enough burn attractiveness that accumulation feels worth it. Either one missing and habit does not form.

### Mechanisms

**Geographic concentration — the principle that now governs everything.**

The unit of expansion is not a city. It is not a constituency. **It is a walkable commercial catchment.** So the goal isn't "launch Mombasa," it's *win Majengo* — then Old Town, then Tudor, then outward.

This is not a preference, it's arithmetic. The merchant-value threshold is a **step function in a local area**, plausibly around 20–30% of a merchant's walk-in traffic being Akiba-active. Four hundred merchants spread across thirty wards crosses it nowhere and produces four hundred merchants who each correctly conclude Akiba did nothing. The same four hundred in two wards crosses it in two wards — and gives you a working proof to sell everywhere else.

It also simplifies consumer messaging enormously, because everyone in the catchment is seeing the same merchants repeatedly. That repetition *is* the habit-formation mechanism.

**Institutional distribution, subordinated to geography.** The tracks are sourcing channels into a chosen footprint, not a coverage strategy:

| Track | Constraint |
|---|---|
| A — Mvita relationships | Filter introductions to *one ward*. The MP's reach spans several; 75 merchants scattered across them is a non-result |
| B — County markets | Marikiti before Kongowea. Take them for footfall and relationship, not for ROI case studies |
| C — Transport SACCOs | Routes terminating in the catchment first, county-wide later |

**One caution on county markets.** Fresh produce runs ~10–15% margin on commodities where stall choice is price and proximity, and the customer was coming anyway — so both earn-side preference lift and redemption incrementality are weak. Build merchant-ROI case studies on the barber and the café, where your numbers will actually be good.

**Track C is the strongest single opportunity in the plan, and the channel is occupied.** Mombasa has ~17,000 tuktuks; since January 2026 every operator must belong to a registered SACCO with a 100-vehicle minimum, and eight are cleared — the aggregation you need was *legally mandated into existence* eight months ago. Only ~4,000 pay county fees, so SACCOs have a live compliance problem and a reason to offer members value. But the county's **KES 200m zero-interest revolving fund** launched July 2026 targeting exactly this group through SACCO membership, with **Ziya** named as county partner. Ride behind them rather than at them — a rider earning on fares he's already collecting is a stickier member and a better credit risk. And lead the rider pitch with **the rider's own earning**, not the passenger's.

### What breaks it — and this is the weak bridge

**Bridge 2 is the only bridge without a mechanism for its hardest component.** Bridge 1 has four concrete mechanisms. Bridge 3 and 4 have plausible ones. Consumer habit formation has geographic concentration, content, and two slogans.

Your own data says that isn't enough. From the MiniPay Week 3 report:

- **65.2% one-time players** — two-thirds of acquired wallets never returned
- **5.9% played 8+ of 10 rounds**; top-tier loyalty fell **15.7% → 10.4% → 5.9%** across three weeks
- The largest activation lever was **removing friction** — entry balance $10 → $1 and raffles moved to the top of the app — not marketing

That was a zero-effort, in-wallet, gamified product with a prize hook, and habit still didn't form for most users. Mombasa asks for something harder: opening a separate app at the moment of paying, in a shop, with a queue behind you.

**The friction finding is the lead, and it should be tested directly.** How much of the earn action can be removed from the consumer entirely? If earning fires off the payment itself — an M-Pesa till reference, a merchant-side confirmation, anything not requiring the consumer to act at the counter — then the habit becomes *checking* ("did I earn?") rather than *acting under time pressure*. Checking habits form reliably. Acting-at-the-till habits mostly don't, and your own data is the evidence for that, not my assumption.

If there is one product bet to place before Bridge 2, it's this one.

### The gate to Bridge 3

- **Median Personal Merchant Coverage ≥ 3 of 10** in the catchment (see metrics)
- **Weekly-active consumers ≥ 15% of catchment downloads**, sustained 8 weeks
- **Merchant renewal ≥ 80%** at full price, with measured local penetration above threshold
- **Repeat redemption rate** showing the burn ladder sustains rather than being a one-time novelty

### The number

**Personal Merchant Coverage.** Ask 30 residents of the catchment to name the 10 places they spend money in a normal week; count how many are live on Akiba. Ninety minutes of street work, monthly, and it beats every supply-side count in the plan.

---

# Bridge 3 · Density → Network effects

**Months 9–18. Merchants begin competing rather than deciding whether to join.**

### The load

The shift from *"should I join?"* to *"what can I offer customers on Akiba?"* — and the point where merchant acquisition stops being a sales cost and becomes organic.

### Mechanisms

Merchant competition, marketplace discovery, better offers, organic merchant acquisition. When a consumer chooses between Shop A (no Akiba), Shop B (earn Akiba), and Shop C (earn more / has a campaign), the earn side stops being retention theatre and becomes genuine competitive positioning. This is the card-acceptance dynamic — *"I spend where I earn"* — and it's real. It just arrives here, not in month one, which is precisely why Bridges 1 and 2 have to be engineered rather than assumed.

### What breaks it

**Competition does not emerge on its own — it's a product feature.** Merchants only compete on Akiba if they can *see* what rivals are offering. If the merchant dashboard shows only their own numbers, no competitive dynamic forms, no matter how dense the network gets. Category benchmarking — *"the average café in this catchment offers X; you offer Y"* — is what converts density into competitive pressure. Without it Bridge 3 stalls at "lots of merchants, nobody trying."

**Cannibalization on repeatable offers.** Frequency gates ("shop 5 times to unlock 25%") are genuinely well-designed, because the discount is funded by the visits that earned it. But a gate is incremental relative to a stranger, not relative to a regular: a customer already visiting weekly clears a 5-visit gate in five weeks with zero behaviour change and collects the reward. The gate is only incremental if set *above* that customer's natural frequency — which requires baseline data merchants don't have early on. Early campaigns set by guesswork will produce some bad ROI stories, and those stories travel (see: merchant belief). This is why campaign recommendations aren't a nice-to-have; they're what stops merchants from setting their own thresholds wrong.

**Pricing.** Flat KES 500 is overpriced in Bridge 1 and badly *underpriced* here. Network access to a dense catchment is worth multiples of KES 500 — but a price anchored on subsidised MSMEs is hard to raise later. Structure the subsidy as an **introductory rate for a fixed term** rather than a price, and write the escalation path in now. Tiering by catchment density is the cleanest version: price rises with active consumers in the merchant's area, so the increase arrives exactly when the merchant can see the value.

### The gate to Bridge 4

- **Organic merchant signups ≥ 25% of new merchants** — merchants arriving without a rep
- **Merchant-funded offers ≥ 40% of active merchants** — the only real signal they believe
- Second catchment reaching Bridge 2's gate using the playbook from the first

### The number

**Share of new merchants arriving organically.** It's the cleanest evidence that the network, not the sales team, is doing the selling.

---

# Bridge 4 · Network effects → Defensibility

**Months 18+. What stops Safaricom, a bank, or Ziya from copying this.**

### The load

Merchant count is not a moat — acceptance is non-exclusive and a duka will run Akiba alongside anything else at zero cost. If the Mombasa model works and you publish the playbook, the parties best placed to copy it have distribution you don't.

### Mechanisms

| Asset | Why it's defensible |
|---|---|
| **Consumer habit** | Genuinely hard to copy; the reason Bridge 2 matters more than merchant count |
| **Cross-merchant behavioural data** | No individual merchant, and no single-merchant loyalty tool, can see it. Improves structurally with scale |
| **Campaign intelligence built on that data** | The compounding layer — see below |
| **Redemption marketplace depth and freshness** | Replicable in principle, expensive in practice, compounds with consumer base |
| **Merchant benchmarking** | Also the Bridge 3 mechanism — one feature doing double duty |

**Campaign recommendations are the differentiator, and your framing of them is the right one.** Don't ask the merchant *"how many visits should earn a reward?"* — they don't know. Ask *what outcome do you want:*

- Increase repeat visits
- Reactivate dormant customers
- Increase average basket
- Fill slow afternoons
- Acquire new customers

Then Akiba recommends the visit threshold, reward amount, expiry and duration — *"based on businesses like yours,"* and eventually *"based on your own customers."* That is product intelligence rather than campaign software, and it's the point where the cross-merchant dataset stops being exhaust and becomes the product.

### What breaks it

**One ward cannot produce enough data to make "businesses like yours" mean anything.** A 75-merchant catchment plausibly contains:

| Category | Merchants |
|---|---|
| Duka / convenience | ~20 |
| Restaurant / kibanda | ~12 |
| Barber / salon | ~10 |
| Café | ~6 |
| Pharmacy | ~5 |
| Other | ~22 |

Five pharmacies is not a benchmark. Most categories give you fewer than ten comparables, and recommendations built on ten businesses are guesses with a confidence interval attached.

This has a real strategic consequence: **defensibility arrives at a scale Mombasa alone may not reach.** Which pulls the playbook framing and the defensibility framing into the same direction — if Bridge 4 needs multi-city category depth, then Mombasa's most valuable output isn't merchant count at all. It's **the instrumentation** — a measurement and campaign-taxonomy standard consistent enough that city two and city three pool into one dataset rather than three incompatible ones.

That should change what Bridge 1 optimises for. Instrument now, at 75 merchants, in a schema that will still be right at 3,000.

### The number

**Campaign recommendation accuracy** — do recommended campaigns outperform merchant-set ones? Until they do, Bridge 4's central asset isn't real.

---

# Cross-cutting

## Unit economics and runway

Unchanged by any of the model corrections, because it depends only on price, CAC and churn. At KES 500/month with a fully-loaded field rep at ~KES 35,000/month signing ~15 merchants/month (CAC ≈ KES 2,333):

| Monthly churn | Avg. life | Revenue LTV | LTV/CAC | Payback |
|---|---|---|---|---|
| 5% | 20.0 mo | KES 10,000 | 4.3× | 4.7 mo |
| 7% | 14.3 mo | KES 7,143 | 3.1× | 4.7 mo |
| 10% | 10.0 mo | KES 5,000 | 2.1× | 4.7 mo |
| **12%** | **8.3 mo** | **KES 4,167** | **1.8×** | **4.7 mo** |
| 15% | 6.7 mo | KES 3,333 | 1.4× | 4.7 mo |

Payback is fixed at 4.7 months regardless of churn — you recover CAC in month five or not at all. **In the 12–15% band the business does not work**, and none of these rows subtract support, standee production, collection fees, or the floor-tier cost below.

Note what this means for the bridge model: **Bridge 1 and Bridge 2 are entirely about keeping this table in its top three rows.** Every mechanism in them — subsidy, content, campaign recommendations, staggered cohorts, geographic concentration — is a churn-reduction instrument.

**City break-even ≈ 1,400 paying merchants** (four field reps, city lead, two content, support ≈ KES 450,000/month; plus KES 150,000 marketing = KES 600,000/month; ~KES 430 net per merchant). Around 1,050 with no marketing spend.

That number should be stated in the plan, because it settles a question the document currently leaves open: **1,400 merchants is not Bridge 1, it's a multi-year outcome.** So Mombasa is a funded proof-of-model whose deliverable is the playbook and the instrumentation — which is a perfectly good answer, and the one the Bridge 4 analysis independently points to. Bridges 1–2 should have an explicit budget and a stated runway in months, because no revenue mechanism closes that gap inside them.

## The floor tier is where Akiba genuinely pays cash

The voucher marketplace costs Akiba nothing. The floor does — nobody acquires a customer from an airtime redemption, and airtime carries thin distributor margin. Meanwhile Akiba's revenue per Mile issued is `500 ÷ Miles issued`, which **falls as you succeed**:

| Merchant turnover | Attach | Miles/mo | Revenue per Mile |
|---|---|---|---|
| KES 50,000 | 20% | 100 | **KES 5.00** |
| KES 50,000 | 30% | 150 | KES 3.33 |
| KES 50,000 | 50% | 250 | KES 2.00 |
| KES 100,000 | 50% | 500 | KES 1.00 |
| KES 250,000 | 100% | 2,500 | **KES 0.20** (cap) |

Against ~KES 1.00 per Mile of floor cost, keeping floor spend under 20% of Mile revenue allows a floor-burn share of ~67% at KES 3.33/Mile but only **~4% at the cap.** Comfortable now, tight later.

**So publish the floor as a current rate, not a permanent promise.** Not "100 Miles = KES 100 airtime" forever — a rate that can move, like an FX rate. Track blended revenue per Mile and floor-burn share monthly and re-set when their product drifts. Devaluing a rewards currency after promising it fixed is the most reliable way to lose trust in it.

## Metrics

**Will mislead you:** *paying merchants* (inflates with subsidised inactives) · *merchant density by ward* (counts merchants, not merchants a real person visits) · *Miles earned* (you control issuance) · *QR scans* (attempts, not completions) · *content views* (vanity).

**Load-bearing, by bridge:**

| Metric | Bridge | Why |
|---|---|---|
| **Merchant renewal, by cohort** | 1 | The whole point of Bridge 1 |
| **Merchant sentiment** (light monthly pulse) | 1 | Moves ~6 weeks before renewal does; belief is contagious in a concentrated cohort |
| **Content-attributed claims / scans / first-time customers** | 1 | Replaces views; also seeds the Bridge 4 dataset |
| **Days from signup to first consumer scan** | 1 | Earliest churn predictor. Past ~21 days, that merchant is leaving |
| **Claimable offers per active consumer per month** | 1→2 | Below ~3, Miles feel worthless whatever the catalogue size |
| **Personal Merchant Coverage** | 2 | The density threshold, measured directly |
| **Scan success rate** | 2 | Every failure teaches a consumer that Akiba doesn't work |
| **Repeat redemption rate** | 2 | Whether the burn ladder sustains |
| **Redemption incrementality** (new/lapsed share) | 3 | When it falls, redemption merchants are subsidising regulars and pull offers in ~90 days |
| **Merchants funding their own offers, % of base** | 3 | The only real signal they believe; also your pricing-power indicator |
| **Organic merchant signups, % of new** | 3 | The network selling for you |
| **Floor-burn share** × **blended revenue per Mile** | 3→4 | The control loop for the floor rate |
| **Campaign recommendation accuracy** | 4 | Whether the moat is real |

---

# Falsification

A city-level thesis can consume eighteen months before anyone admits it isn't working. **The thesis is wrong if,** in one saturated catchment with 60+ live merchants, a stocked burn ladder, and active consumer marketing:

- Median Personal Merchant Coverage stays below 3 of 10 after 12 weeks, **or**
- Weekly-active consumers stay under 15% of catchment downloads after 8 weeks, **or**
- Cohort renewal at full price stays under 70% **despite** measured local penetration above threshold, **or**
- Redemption incrementality falls below 40% and redemption merchants begin withdrawing offers

Any two together and the answer is not more merchants. The product needs to change shape before the network gets bigger — and the friction bet in Bridge 2 is the first thing to change.

---

# The first 90 days

1. **Pick the catchment.** One walkable area. Majengo, Old Town or Tudor. Write it down; refuse to spread.
2. **Stock the burn ladder before anything else.** One aspirational anchor, 3–4 repeatable mid-tier offers, airtime, a low-balance game tier.
3. **Filter the political introductions to that catchment.** A small ask of the relationship, and the difference between a proof point and 75 scattered merchants.
4. **Onboard in fortnightly cohorts of 15–20.** Renewals spread automatically; onboarding improves between cohorts; each cohort tests what the last one taught you.
5. **Rebuild the content format around a call to action** before the first video ships. Claims, scans, first-time customers — never views.
6. **Instrument in a schema that survives to 3,000 merchants.** Campaign taxonomy, offer types, attribution. This is Bridge 4's foundation and it costs almost nothing to get right now.
7. **Run consumer acquisition in that catchment only, concurrently** — not as a later phase.
8. **Test the friction bet.** How much of the earn action can be removed from the consumer entirely?

---

# What to keep, unchanged

- **The reframe.** "Default rewards layer for everyday commerce in one city" is right, because the product genuinely has no value at low density and large value at high density.
- **The needs → wants architecture.** The strongest idea in the document. It sidesteps the closed-loop trap entirely and gives redemption merchants a real reason to participate — they're competing for exactly that discretionary spend. Lead every conversation with it.
- **Dual merchant benefit** — network access plus merchant-specific tooling — stronger than either alone.
- **Institutional distribution** as the answer to merchant CAC. Fix the geography, keep the mechanic.
- **Track C**, with unusually good timing.
- **Merchant psychology over merchant arithmetic.** Merchants buy because they believe this could bring them customers, and content works because it proves Akiba is trying to create demand rather than charging rent. That insight should shape every merchant-facing decision in Bridges 1 and 2.
- **The playbook framing.** Bridge 4's data-depth problem says the same thing from the other direction: Mombasa's real output is a repeatable, instrumented playbook.

---

## Sources

- [MiniMiles × MiniPay Week 3 Raffle Report](computer:///Users/ibraziz21/Desktop/Work/MiniMiles/AkibaMiles_MiniPay_Week3_Report.pdf) — retention and loyalty figures
- [Mombasa sets January deadline for tuk-tuk operators' SACCO registration](https://eastleighvoice.co.ke/coast/247962/mombasa-sets-january-deadline-for-tuk-tuk-operators'-sacco-registration) — ~17,000 tuktuks, ~4,000 compliant, 100-vehicle SACCO minimum, 8 cleared
- [Mombasa county's Sh200m revolving fund to be rolled out next month](https://www.the-star.co.ke/counties/coast/2026-06-29-mombasas-sh200m-revolving-fund-to-be-rolled-out-next-month) — KES 200m fund, SACCO-gated, Ziya named as county partner
- [Kenya Now Has 93 Smartphones for Every 100 Phones](https://techweez.com/2026/04/07/kenya-smartphones-penetration-feature-phone-decline/) — 92.9% smartphone penetration, Dec 2025
- [IEBC gazettes 2027 election period](https://citizen.digital/article/iebc-gazettes-2027-election-period-unveils-key-timelines-for-aspirants-and-campaigns-n388705) — election period commenced 20 Aug 2026 (context only; the 3-month access play is not exposed to the 2027 outcome)
