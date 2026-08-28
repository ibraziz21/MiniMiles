# Akiba Mombasa GTM — Pressure Test v2

*24 August 2026 — revised against the actual Akiba mechanics*

---

## The model this document is testing

Superseding v1, which tested a clearing-house model Akiba does not run:

> Akiba is not a merchant-to-merchant loyalty clearing system. It is a consumer rewards network. Participating merchants gain access to the network by allowing consumers to earn Akiba through purchases, while merchants independently fund offers and vouchers when they want to attract or retain Akiba users. Miles are an internal engagement unit, not a monetary claim against the merchant that issued them.

Mechanically:

- **Akiba Micro, KES 500/month**, entitles a merchant to issue up to **2,500 Miles/month**
- Earn rate **1 Mile per KES 100** of consumer spend — so the subscription covers **KES 250,000/month** of attached spend
- Consumers burn Miles on **merchant-funded offers**: discounts, vouchers, BOGO, bundles — repeatable or one-time, at the redeeming merchant's discretion and economics
- Akiba carries **no per-Mile liability** on the voucher marketplace, and **no balance-sheet claim** against issuing merchants

Three consequences follow immediately, and v1 got all three wrong: breakage is not a revenue line, the issuance cap is a sensible guardrail rather than an underwater backstop, and the "subscription *or* float" framing was a false binary. Revenue can legitimately come from subscription, campaign spend, performance fees, larger plans, and sponsored rewards at once.

**What survives, restated.** The risks below are not imported from closed-loop points programs. They are the failure modes specific to a two-sided rewards network in its first eighteen months.

---

## 1. The cold-start valley — the network benefit is real, but it arrives late

The Visa analogy is correct about the destination and silent about the journey, and the journey is where the money gets spent.

A restaurant accepts Visa because approximately every customer carries one. In the years when 2% of customers carried a card, accepting Visa was worth roughly nothing to a merchant — and card networks bridged that gap by charging merchants nothing until acceptance was already valuable. Akiba in Mombasa in 2026 is at the 2% stage and charging KES 500/month from day one.

Put it as a formula, because it's the number the whole plan turns on:

> **Merchant value ≈ (share of that merchant's customers who are Akiba-active) × (preference lift from earning) × (merchant margin)**

At 2% local penetration the first term annihilates the product. There is a threshold — plausibly somewhere around **20–30% of a merchant's walk-in traffic being Akiba-active** — below which "Shop B lets me earn" changes nobody's choice and the merchant correctly concludes they bought nothing. Above it, your Visa dynamic switches on and the pitch becomes self-evident.

This does not make the earn side worthless. It makes it worthless *in a specific window*, and that window is exactly when merchants are deciding whether to renew.

**Three implications:**

- **Merchant tooling is not an addendum, it is the entire value proposition for 12–24 months.** Campaigns, targeted offers, repeat-visit incentives, analytics — these produce merchant-attributable results at *any* consumer penetration, because a targeted offer works on ten customers as well as ten thousand. Network access produces results only above the threshold. So the KES 500 must be *sold* on the tooling and *priced* for the tooling until density arrives. Base Miles issuance is the rail, not the pitch.
- **Concentration is not a preference, it is the mechanism.** The threshold is local and it's a step function, not a slope. 400 merchants spread across 30 wards crosses it nowhere. 400 merchants in two wards crosses it in two wards and gives you a working Visa dynamic to sell everywhere else. See §6.
- **You need to instrument the threshold, not guess it.** Ask merchants monthly what share of their customers they think are on Akiba, and cross it against renewal. The ward where renewal rate inflects is your threshold, and it's the most valuable number the Mombasa launch can produce.

---

## 2. Redemption supply — you've accepted this; here's what it needs to have teeth

Adding "Redemption Inventory" as workstream 4 is the right call. Three things turn it from a workstream into a control system.

**A. A ratio, tracked weekly.** A consumer spending KES 10,000/month earns ~100 Miles/month. Attractive offers must exist for roughly that accumulation rate, in categories the consumer actually wants, or perceived Mile value collapses. Your starting catalogue — 5 restaurants, 3 cafés, 3 fashion, 2 electronics, airtime/data, 2 experiences, beauty — is a sensible shape for a first ward. The number to watch is not catalogue size but **claimable offers per active consumer per month**: how many live offers does a given consumer both qualify for and plausibly want? Below ~3, Miles feel worthless regardless of how many logos are on the page.

**B. A hard sequencing rule.** Redemption attractiveness must lead earn density, not lag it. A consumer who accumulates Miles and finds nothing worth having has learned something you cannot un-teach, and they learned it *because* you succeeded at the earn side. **Do not push consumer acquisition in a ward until the burn ladder is stocked there.** This inverts the current Phase 1 → Phase 3 ordering and it's the single highest-value change to the GTM.

**C. Offer freshness as a standing obligation.** A static catalogue decays in perceived value even when nothing is removed — the same six offers in month four read as "nothing new." Budget for a rotating slot: some number of new or refreshed offers per month, owned by someone, with a target.

Your **burn ladder** is better than my raffle-as-foundation suggestion and I'd adopt it as written:

| Balance | Burn options | Purpose |
|---|---|---|
| Low (< ~100 Miles) | Games, raffles, micro-rewards | Nothing is ever "not enough" |
| Medium | Airtime, data, coffee, food | Reliable, universal, always available |
| High | Meaningful vouchers, experiences, electronics | Aspiration; the reason to keep earning |

The ladder's job is that **there is always something achievable at every balance.** That's the thing that keeps the earn habit alive, and it's a stronger design than making the raffle carry the floor.

---

## 3. Cannibalization replaces depletion — same urgency, different mechanism

You're right that first-time-customer offers were my import from your Bata example, not an inherent property of the model, and that repeatable offers are viable. A restaurant taking a KES 200 discount against a KES 1,500 basket, monthly, is good business.

But repeatable offers swap a depleting-catalogue risk for a subtler one that surfaces later and hurts more.

The redemption merchant's honest question is never "is this basket profitable?" It is **"would this person have come anyway?"** For a genuinely new customer, the KES 200 buys a customer. For a regular who eats there every fortnight, the KES 200 buys nothing — it's a discount on revenue you already had. A repeatable offer with no targeting will be claimed disproportionately by exactly the customers who needed no incentive, because they're the ones already in the building.

Timeline: this takes three to six months to become visible in the merchant's own numbers, which is precisely when your first redemption cohort is deciding whether to renew and expand. A wave of redemption merchants pulling offers simultaneously, at the moment consumer accumulation is peaking, is the worst-shaped failure in this plan.

**The fix is product, and it's the same product as §1.** Repeatable redemption is economically sustainable *only* with targeting: let the merchant aim an offer at lapsed customers, low-frequency customers, or people who've never transacted with them, rather than broadcasting to everyone with 500 Miles. Akiba is uniquely able to do this because it sees cross-merchant behaviour that no individual merchant can.

Note where that lands: **the targeting layer is what makes the earn side sellable before density (§1) and what makes the redemption side sustainable after it (§3).** One capability, both sides of the network, and it is currently one bullet ("advanced campaigns") in the Growth tier. That's the actual product.

---

## 4. The floor tier is the one place Akiba genuinely pays cash — size it deliberately

The voucher marketplace costs Akiba nothing. The floor does, and the floor is the part you correctly insist on having.

Nobody acquires a customer from an airtime redemption. Airtime carries thin distributor margin, so KES 100 of airtime costs roughly KES 95–97. Somebody funds that, and structurally it can only be Akiba. So the floor tier is a real, variable, per-Mile cost line — and it's the residue of v1's point 1, correctly scoped to about a fifth of the burn rather than all of it.

Here is why it needs a policy, not a fixed promise. Akiba's revenue per Mile issued is `500 ÷ Miles issued`, which **falls as the product succeeds**:

| Merchant turnover | Attach rate | Miles/month | Akiba revenue per Mile |
|---|---|---|---|
| KES 50,000 | 20% | 100 | **KES 5.00** |
| KES 50,000 | 30% | 150 | KES 3.33 |
| KES 50,000 | 50% | 250 | KES 2.00 |
| KES 100,000 | 50% | 500 | KES 1.00 |
| KES 250,000 | 100% | 2,500 | **KES 0.20** (cap) |

Against a floor cost of ~KES 1.00 per Mile burned, and a target of keeping floor spend under 20% of Mile revenue:

| Revenue per Mile | Max sustainable floor-burn share |
|---|---|
| KES 3.33 | 67% |
| KES 2.00 | 40% |
| KES 1.00 | 20% |
| KES 0.20 | **4%** |

Early on this is comfortable — you can afford most of the burn to hit the floor. At scale, with high attach rates and larger merchants pressing the cap, it isn't. Same structural dynamic as v1, but now correctly confined to one tier and entirely manageable **if you treat the floor exchange rate as a lever rather than a promise.**

**Concretely:** don't publish "100 Miles = KES 100 airtime" as a permanent fact. Publish it as a current rate, the way an FX rate is current, and reserve the right to move it. Then track two numbers monthly — **blended revenue per Mile issued** and **floor-burn share** — and re-set the rate when their product drifts. Building in the expectation of a fixed floor rate and then having to devalue it later is the single most reliable way to lose consumer trust in a rewards currency.

---

## 5. KES 500 flat is the wrong shape — and the subsidy makes it unfixable

I withdraw "make the earn side loss-leading." Your distribution pitch is right: *"100,000 people in Mombasa are earning Akiba when they shop. Your competitors participate. Do you want customers to earn here too?"* is a real pitch, and at 100,000 users KES 500/month is not loss-leading — it is **dramatically underpriced.** Network access to a city's active consumer base is worth multiples of that.

Which is the actual problem. A flat KES 500 is:

- **Overpriced at launch**, relative to delivered value in the cold-start valley (§1) — driving the churn that makes the valley expensive
- **Underpriced at density**, capturing almost none of the network value you spent two years building
- **Effectively frozen**, because you cannot meaningfully raise a price you anchored on MSMEs and then had a *county government subsidise* as an MSME support measure. The moment Akiba is politically framed as affordable MSME infrastructure, a price rise is a story about a startup exploiting small traders. Track A and Track B, as written, hard-code the wrong price into the business permanently.

**The fix is to make the price a function of the thing that grows.** Options, roughly in order of how well they'd travel in this market:

- **Tier by ward density** — the price of access rises with active Akiba consumers in the merchant's catchment. Defensible, transparent, and the increase arrives exactly when the merchant can see the value.
- **Keep base access cheap or free; monetise tooling and campaigns** — campaign spend scales with merchant confidence and needs no price rise. This is probably the cleanest path given the political constraint.
- **Performance fees on attributed redemption**, layered later — not as a replacement for subscription, but because it's the one moment where value is provably created and attributable.

At minimum: **write the escalation into the contract now**, and structure the institutional deals as a *subsidised introductory rate for a fixed term* rather than as a price. That single word choice preserves your ability to charge what the network is worth.

---

## 6. Phase 1 and Phase 2 still point in opposite directions — and §1 makes it worse

Unchanged from v1, and the density-threshold argument strengthens it.

Phase 1's goal is *"critical mass of merchants in a concentrated geography."* Phase 2's method delivers three non-overlapping geographies:

| Track | Where it lands |
|---|---|
| A — Mvita MSME Programme | Mvita constituency, the island |
| B — County markets (Kongowea, Marikiti) | Kongowea is in Nyali; Marikiti is on the island |
| C — Transport SACCOs | County-wide by definition |

Institutional distribution optimises for whoever signs, not for where a person walks in a day. Because the merchant-value threshold in §1 is a **step function in a local area**, spreading 400 merchants across 30 wards crosses it nowhere and produces 400 merchants who all correctly conclude Akiba did nothing.

**The fix:** treat the institutional tracks as *sourcing channels into a chosen footprint*, not as a coverage strategy. Mvita's island wards — Majengo, Tudor, Tononoka, Old Town — are the obvious first target: dense, walkable, high foot traffic, and Track A's sponsor already represents exactly that ground. Sequence Marikiti ahead of Kongowea. Take the tuktuk routes that terminate on the island before the county-wide SACCO rollout.

**One genuine caution on the county markets.** Kongowea and Marikiti will be the county's first offer because they're the showcase. But fresh produce runs ~10–15% margin on commodities where stall choice is driven by price and proximity, and the customer was coming to the market anyway — so both the earn-side preference lift and the redemption-side incrementality are weak. Take them for footfall and for the political relationship. Don't build merchant-ROI case studies on them. Build those on the barber, the café, the pharmacy — high margin, discretionary repeat, and the categories where your numbers will actually be good.

---

## 7. Your own retention data still contradicts Phase 3 — and now there are two thresholds

Phase 3 gets one paragraph and two slogans for the hardest problem in the plan. From the MiniPay Week 3 report:

- **65.2% one-time players** — two-thirds of acquired wallets never returned
- **5.9% played 8+ of 10 rounds**; top-tier loyalty fell 15.7% → 10.4% → 5.9% across three weeks
- The biggest activation lever was **removing friction** (entry balance $10 → $1, raffles moved to the top of the app), not marketing

That was a zero-effort, in-wallet, gamified product with a prize hook, and habit still didn't form for most users. Mombasa asks for something harder.

And under the correct two-sided model it's harder than v1 said, because the consumer needs **both thresholds crossed at once**: enough earn density that Miles accumulate at a noticeable rate, *and* enough burn attractiveness that accumulation feels worth it. Either one missing and the habit doesn't form. That's not an argument against the strategy — it's an argument that these two workstreams must be synchronised in a single ward rather than run as sequential city-wide phases.

**Also worth testing directly:** how much of the earn action can be removed from the consumer? If earning can fire off the payment itself — an M-Pesa till reference, a merchant-side confirmation — the consumer's habit becomes *checking* ("did I earn?") rather than *acting at the till with a queue behind them.* Checking habits form reliably. Acting-at-the-till habits mostly don't, and your own data is the evidence.

---

## 8. You are launching a political distribution strategy into an election

**Kenya's official election period commenced on 20 August 2026 — four days ago.** Poll is 10 August 2027. Party primaries conclude 8 May 2027. Public officers must resign by 10 February 2027.

Two of your three tracks run through people who are now, formally, candidates.

- **Every deal has a shelf life.** An agreement with the sitting Mvita MP or the Governor's office is worth what their incumbency is worth. A successor inherits nothing and has an active incentive to scrap a predecessor's branded programme.
- **"Mombasa Everyday Rewards" hands the asset away.** Name it after the county and the county owns it. Keep the brand Akiba; let the sponsor take the *credit*, not the *name*.
- **Akiba gets coded politically whether you like it or not.** Merchants aligned with the other side will refuse. Phase 5's "Akiba remains neutral" is a good instinct that Phase 2's structure directly contradicts.
- **NG-CDF has unresolved constitutional risk.** The Court of Appeal upheld the Act on 6 February 2026, reversing the High Court, but a notice of appeal to the Supreme Court was filed the same day and hasn't been heard. If Track A's subsidy is NG-CDF-funded, that's the ground it stands on.

**Do this:** contract with the constituency *programme* or a registered CBO, not the officeholder. Keep the merchant relationship in Akiba's name — Akiba's paperwork, Akiba's onboarding, Akiba's signage — with the sponsor credited. Get everything signed and onboarded **before February 2027**, because after the resignation deadline nothing gets decided until late 2027. And per §5, structure the subsidy as an introductory rate with a term, not as a price.

---

## 9. Track C is your best idea, and the channel is already occupied

The transport thesis is right — highest frequency, unavoidable spend, natural daily touchpoint. Two facts improve it and one complicates it.

**For you:**
- Mombasa has roughly **17,000 tuktuks**, and since the January 2026 framework every operator must belong to a registered SACCO with a 100-vehicle minimum. Eight SACCOs are cleared. The aggregation you need was **legally mandated into existence eight months ago.**
- Only ~4,000 of 17,000 currently pay county fees, so the SACCOs have a live compliance problem and a reason to offer members something of value.

**Against you:**
- The county's **KES 200m zero-interest revolving fund** rolled out in July 2026, targeting exactly this group through SACCO membership, with **Ziya** named as the county's partner. You're walking in behind someone offering capital while you offer rewards.
- The SACCO mandate is coded as *extraction* — registration, stickers, fees, enforcement. Anything arriving through that channel reads as another levy unless it visibly puts money in the rider's pocket.

**The fix:** ride behind Ziya rather than at them. Rewards attach naturally to a repayment relationship — a rider earning on fares he's already collecting is a stickier SACCO member and a better credit risk. And lead the rider pitch with **the rider's own earning**, not the passenger's. The operator should be making something from Akiba before you ask him to ask passengers to scan.

---

## 10. Merchant unit economics — unchanged by the model correction

This math depends only on price, CAC and churn, so it survives v1 intact. At KES 500/month with a fully-loaded field rep at ~KES 35,000/month signing ~15 merchants/month (CAC ≈ KES 2,333):

| Monthly churn | Avg. life | Revenue LTV | LTV/CAC | Payback |
|---|---|---|---|---|
| 5% | 20.0 mo | KES 10,000 | 4.3× | 4.7 mo |
| 7% | 14.3 mo | KES 7,143 | 3.1× | 4.7 mo |
| 10% | 10.0 mo | KES 5,000 | 2.1× | 4.7 mo |
| **12%** | **8.3 mo** | **KES 4,167** | **1.8×** | **4.7 mo** |
| 15% | 6.7 mo | KES 3,333 | 1.4× | 4.7 mo |

Payback is fixed at 4.7 months regardless of churn — you recover CAC in month five or not at all. **In the 12–15% band the business doesn't work**, and none of these rows yet subtract support, standee production, M-Pesa collection fees, or the floor-tier cost from §4.

Note how §1 and this table interact: the cold-start valley is precisely a churn-rate problem, and churn is the variable this model is most sensitive to. Everything in §1 and §5 is ultimately an argument about keeping this table in its top three rows.

**City break-even.** Four field reps, a city lead, two content (Shaif, Bai), support ≈ KES 450,000/month fully loaded; plus KES 150,000 marketing = **KES 600,000/month**. Net of collection fees you keep ~KES 430/merchant. Break-even is **~1,400 paying merchants**, or ~1,050 with no marketing spend.

That reframes the plan: 1,400 paying merchants is not "Phase 1," it's a multi-year outcome for a KES 500 product. So Mombasa is either a **funded proof-of-model** whose deliverable is the playbook, or it needs the revenue mix from §5 to arrive faster than the merchant count. Both are defensible. The document should say which, because it changes what Phase 1 optimises for.

---

## 11. Metrics — the current set will report good news while the thing fails

**Will mislead you:** *paying merchants* (inflates with subsidised inactives) · *merchant density by ward* (counts merchants, not merchants a real person visits) · *Miles earned* (you control issuance; this measures your generosity) · *QR scans* (counts attempts, not completions).

**Missing, each load-bearing:**

| Metric | Why |
|---|---|
| **Personal Merchant Coverage** — ask 30 residents of the target ward to name the 10 places they spend weekly, count how many are live | The §1 threshold, measured directly. A 90-minute street survey that beats every supply-side count in the plan |
| **Claimable offers per active consumer per month** | The §2 ratio. Below ~3, Miles feel worthless whatever the catalogue size |
| **Floor-burn share** and **blended revenue per Mile issued** | The §4 control loop. Their product tells you when to move the floor rate |
| **Redemption incrementality** — share of redemptions by customers new or lapsed to that merchant | The §3 early warning. When this falls, redemption merchants are subsidising regulars and will pull offers in ~90 days |
| **Scan success rate** | Every failure teaches a consumer that Akiba doesn't work |
| **Days from merchant signup to first consumer scan** | Earliest churn predictor you can instrument. Past ~21 days, that merchant is leaving |
| **Repeat redemption rate** | Whether the burn ladder actually sustains, or is a one-time novelty |
| **Merchants funding their own offers, as % of base** | The only real signal that merchants believe. Also your §5 pricing-power indicator |

---

## 12. The moat, restated for the correct model

v1's answer was wrong for this model. Under a network where merchants fund their own offers, the defensible assets are:

1. **Consumer habit** — genuinely hard to copy, and the reason §7 matters more than merchant count
2. **Cross-merchant behavioural data and the targeting it enables** — no individual merchant and no single-merchant loyalty tool can see this. It's the one thing that gets structurally better with scale, and per §3 it's also the capability both sides of the network depend on
3. **Offer inventory quality and freshness** — replicable in principle, expensive in practice, and it compounds with consumer base rather than depleting (that correction I accept fully)

Merchant count is not a moat — acceptance is non-exclusive and a duka will run Akiba alongside anything else at no cost. If the Mombasa model works and you publish the playbook, the parties best placed to copy it are Safaricom, a bank, and Ziya, all with distribution you don't have. **What they can't easily copy is two years of cross-merchant behavioural data in one city and the consumer habit attached to it.** That argues for going deep in Mombasa before going wide, and for treating the data layer as a product rather than a byproduct.

---

## 13. Falsification, and what to do first

The plan has no falsification condition. Add one, because a city-level thesis can consume eighteen months before anyone admits it isn't working.

**The thesis is wrong if,** in one saturated ward with 150+ live merchants, a stocked burn ladder, and active consumer marketing:

- Median Personal Merchant Coverage stays below 3 of 10 after 12 weeks, **or**
- Weekly-active consumers in that ward stay under 15% of ward downloads after 8 weeks, **or**
- Merchant renewal at month 4 is under 70% **despite** measured local penetration above the §1 threshold, **or**
- Redemption incrementality falls below 40% and redemption merchants begin withdrawing offers

Any two together and the answer isn't more merchants — the product needs to change shape before the network gets bigger.

**The first move is not Phase 1.** It's a six-to-eight week single-ward experiment, self-funded, before any political capital is spent:

1. **Stock the burn ladder first.** One aspirational anchor, 3–4 repeatable mid-tier offers, airtime, and a low-balance game tier. Nothing else starts until this exists.
2. **Sign 60–80 earn merchants manually, at full price, in one island ward.** No subsidy, no institution. If you can't sell 60 merchants at KES 500 with a founder in the room, the institutional tracks won't fix that — they'll hide it.
3. **Weight the mix** toward high-margin discretionary-repeat categories: barber, café, kinyozi, pharmacy, restaurant.
4. **Run consumer acquisition in that ward only, concurrently** — not in a later phase.
5. **Measure** PMC, claimable-offers-per-consumer, scan success, signup-to-first-scan, redemption incrementality, floor-burn share.

That costs a fraction of the full plan and it answers the two questions everything rests on — *will merchants pay* and *will consumers form the habit* — before you spend political capital you only get to spend once, in a window that closes in February 2027.

---

## What I'd keep, unchanged

- **The reframe itself.** "Default rewards layer for everyday commerce in one city" is the right strategy, because the product genuinely has no value at low density and large value at high density.
- **The needs → wants architecture.** Earning from unavoidable daily spend and burning on discretionary spend is the strongest idea in the document. It sidesteps the closed-loop trap entirely, and the redemption merchants participate because they're competing for exactly that discretionary spend. This is the thing to lead every conversation with.
- **The dual merchant benefit** — network access plus merchant-specific tooling — is stronger than either alone, and is the correct answer to §1.
- **Institutional distribution** as the answer to merchant CAC. Fix the geography, keep the mechanic.
- **Track C**, with unusually good timing.
- **Micro as adoption-maximising rather than ARPU-maximising**, provided §5's escalation path is written in from the start.
- **The playbook framing.** If Mombasa's job is a repeatable playbook, rigorous measurement *is* the deliverable — which should change what Phase 1 optimises for.

---

## Sources

- [MiniMiles × MiniPay Week 3 Raffle Report](computer:///Users/ibraziz21/Desktop/Work/MiniMiles/AkibaMiles_MiniPay_Week3_Report.pdf) — retention and loyalty figures
- [IEBC gazettes 2027 election period, unveils key timelines](https://citizen.digital/article/iebc-gazettes-2027-election-period-unveils-key-timelines-for-aspirants-and-campaigns-n388705) — election period commenced 20 Aug 2026; poll 10 Aug 2027; public officer resignation 10 Feb 2027
- [Battle on NG-CDF legality heads to Supreme Court](https://www.citizen.digital/article/battle-on-ng-cdf-legality-heads-to-supreme-court-after-respondents-file-notice-of-appeal-n377040) — Court of Appeal upheld the Act 6 Feb 2026; Supreme Court appeal pending
- [Mombasa sets January deadline for tuk-tuk operators' SACCO registration](https://eastleighvoice.co.ke/coast/247962/mombasa-sets-january-deadline-for-tuk-tuk-operators'-sacco-registration) — ~17,000 tuktuks, ~4,000 compliant, 100-vehicle SACCO minimum, 8 cleared
- [Mombasa county's Sh200m revolving fund to be rolled out next month](https://www.the-star.co.ke/counties/coast/2026-06-29-mombasas-sh200m-revolving-fund-to-be-rolled-out-next-month) — KES 200m fund, SACCO-gated, Ziya named as county partner
- [Kenya Now Has 93 Smartphones for Every 100 Phones](https://techweez.com/2026/04/07/kenya-smartphones-penetration-feature-phone-decline/) — 92.9% smartphone penetration, Dec 2025
