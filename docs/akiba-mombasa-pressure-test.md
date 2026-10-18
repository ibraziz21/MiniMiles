# Akiba Mombasa GTM — Pressure Test

*24 August 2026*

---

## Where I'm coming from

The reframe is right. "Default rewards layer for everyday commerce in one city" is a better strategy than "sell loyalty software," because it correctly identifies that the product has no value at low density and enormous value at high density. Institutional distribution as the answer to merchant CAC is also right, and Track C is the strongest idea in the document.

But the document has one hole big enough to swallow the whole plan, and several places where the phases quietly contradict each other. Below, in order of how much they matter.

---

## 1. The document never says who pays for the Miles

This is the fatal one. Everything else is fixable.

Akiba Micro is KES 500/month. A merchant doing KES 50,000/month in turnover, with 20% of it running through Akiba, issuing Miles at a 2% rate, generates **KES 200/month of Miles liability**. Push attach rate to 60% and that's KES 600/month — more liability created than subscription revenue collected. And that's a small merchant.

So one of three things has to be true, and the strategy reads differently under each:

**(a) Merchants fund their own Miles.** Then KES 500 is not the price. The price is KES 500 *plus a rewards budget*, and the rewards budget is the number the merchant actually negotiates on. Every "KES 500/month, designed for MSMEs" pitch becomes a bait-and-switch at the point of sale. Your field close rate collapses on the second conversation, not the first.

**(b) Akiba funds the Miles.** Then Akiba is buying gross margin at KES 500/month and the business is structurally negative — worse the more successful it gets. Growth destroys you.

**(c) Miles are earned at Merchant A and redeemed at Merchant B, and Akiba clears between them.** This is what the Consumer Value Proposition section actually describes — earn on needs, redeem on wants. It is the most interesting version and the hardest. It means Akiba must collect real cash from the earn side and pay real cash (or verified discount) to the redeem side, net of breakage. That is a payments business with float, settlement, and a liability on the balance sheet. It cannot be run on KES 500/month subscriptions.

**The fix:** decide this before anything else, and write it into the doc as a numbered mechanism, not a value proposition. My read is that (c) is what you want and (a) is what you can actually sell on day one. If so, the honest version of Micro is:

> KES 500/month platform fee + merchant-set rewards budget, prepaid into a Miles float. Merchant controls the rate. Akiba clears cross-merchant redemption against the float and keeps the breakage.

Breakage is your real revenue line. It doesn't appear anywhere in the document.

---

## 2. Phase 1 and Phase 2 are pulling in opposite directions

Phase 1's goal is explicit: *"a critical mass of merchants in a concentrated geography."*

Phase 2's method is institutional, and the institutions map to three non-overlapping geographies:

| Track | Where it lands |
|---|---|
| A — Mvita MSME Programme | Mvita constituency, the island |
| B — County (Kongowea, Marikiti) | Kongowea is in Nyali; Marikiti is on the island |
| C — Transport SACCOs | County-wide, by definition |

Institutional distribution optimises for *whoever will sign*, not for *where a consumer walks in a day*. Run all three tracks and you get 400 merchants spread across 30 wards — which is 13 merchants per ward, which is invisible. The consumer opens Akiba, finds nothing near them, and learns the network doesn't work. That lesson is very hard to un-teach.

**The fix:** pick one ward and treat the institutional tracks as a *sourcing* channel into it, not as a coverage strategy. Mvita's island wards (Majengo, Tudor, Tononoka, Old Town) are the obvious candidate: dense, walkable, high foot traffic, and Track A's political sponsor already represents exactly that geography. Track B and Track C get sequenced *behind* that, and only where they land inside the target footprint — Marikiti before Kongowea, tuktuk routes that terminate on the island before county-wide SACCOs.

---

## 3. Supply-first sequencing contradicts your own retention data

Phase 3 — consumer habit — gets one paragraph and two slogans. It is the hardest phase in the plan and the only one you already have data on.

From the MiniPay Week 3 report:

- **65.2% one-time players.** Two-thirds of acquired wallets never came back.
- **5.9% played 8+ of 10 rounds.** Top-tier loyalty fell across the campaign: 15.7% → 10.4% → 5.9%.
- The single biggest activation lever was removing friction (entry balance $10 → $1, raffles moved to the top of the app), not marketing.

That was a *zero-effort, in-wallet, gamified* product with a prize hook — and habit still didn't form for the overwhelming majority. Mombasa asks for something considerably harder: remember to open a separate app *at the moment of paying*, in a shop, with a queue behind you.

Phase 3 saying "the objective is habit" is a statement of intent, not a mechanism. The document contains no answer to the actual question, which is: **what makes a person open Akiba at the till when they weren't going to?**

**The fix:** two things, and neither is a campaign.

- **Cut the app out of the earn moment.** The strongest version of this product doesn't require the consumer to do anything at the point of sale. If earning can be triggered off the payment itself — an M-Pesa till reference, a merchant-side confirmation, anything that fires without the consumer opening Akiba — the habit problem becomes a *checking* habit ("did I earn?") instead of an *acting* habit. Checking habits form. Acting-at-the-till habits mostly don't.
- **Move Phase 3 to run concurrently with Phase 1, inside the target ward only.** Density is local. You do not need city-wide density to make one neighbourhood work, and you cannot afford six months of merchant churn while you wait for consumers to show up.

---

## 4. The subsidy trap, and the wrong merchants

Two problems stacked.

**Subsidised merchants are not merchants.** A business that didn't pay for Akiba has no switching cost, no sunk commitment, and no reason to train staff or display signage. They will show up in "paying merchants" and "merchant density by ward" while being functionally dead. Every dead merchant on the map is a consumer who scanned and got nothing.

Also note the ambiguity: *"Subsidize Akiba Micro"* — subsidised **by whom?** If the MP's programme pays Akiba KES 500/merchant/month, that's revenue and it's excellent. If Akiba discounts to zero and the MP supplies only the introduction, it's a cost centre that consumes the same support load as a paying merchant. The document reads as if these are the same thing. They are opposites. Never sign a subsidised merchant at a price of zero — get the institution to pay something, even KES 100, because the invoice is what creates the accountability relationship.

**Loyalty economics don't work in fresh produce.** Kongowea and Marikiti are the county's showcase assets, so they'll be the county's first offer. But a tomato trader operates on ~10–15% margin selling a commodity where the customer's choice of stall is driven by price and proximity. There is no repeat-visit behaviour to buy, because the customer was coming to the market anyway. Giving away 2% of a 12% margin to change nothing is a bad trade, and the trader will work that out within a month.

Loyalty works where margin is high and the repeat visit is genuinely discretionary: **coffee, barber, salon, pharmacy, restaurant, kinyozi, bar, electronics, phone accessories.** Your Consumer Value Proposition names most of these on the *redeem* side. They belong on both sides.

**The fix:** accept the county markets as a *political* asset and a consumer-footfall asset, not as a revenue asset or an ROI proof point. Onboard them free, cheap, and last. Prove merchant ROI on a barber and a coffee kiosk first, because those are the case studies that sell the next 200 merchants — and because they're the ones where the number will actually be good.

---

## 5. You are launching a political partnership strategy into an election

**Kenya's official election period commenced on 20 August 2026 — four days ago.** Election day is 10 August 2027. Party primaries conclude by 8 May 2027. Public officers must resign by 10 February 2027.

Two-thirds of your distribution strategy runs through people who are now, formally, candidates.

What that means concretely:

- **Every deal has a shelf life.** An agreement signed with the sitting Mvita MP or the Governor's office in Q4 2026 is worth what their incumbency is worth. If either loses in August 2027, the successor inherits nothing and has an active incentive to kill the predecessor's branded programme. "Mombasa Everyday Rewards" is exactly the kind of thing a new administration renames or scraps.
- **Akiba gets coded politically whether you like it or not.** A rewards network branded alongside a sitting MP, distributed through his constituency programme, in the twelve months before he defends the seat, is a campaign asset. Merchants aligned with the other side will read it that way and refuse. So will some consumers. Your "Akiba remains neutral" line in Phase 5 is a good instinct — it is directly contradicted by Phase 2's structure.
- **NG-CDF itself is contested.** The Court of Appeal upheld the NG-CDF Act on 6 February 2026, reversing the High Court, but a notice of appeal to the Supreme Court was filed the same day and hasn't been heard. If Track A's subsidy is funded from NG-CDF, the funding source has unresolved constitutional risk sitting over it.

**The fix, and I'd treat this as urgent:**

- **Move fast on Track A, but structure it to survive.** Contract with the *constituency programme or a registered CBO/association*, not with the officeholder. Get the merchant relationship in Akiba's name — Akiba's paperwork, Akiba's onboarding, Akiba's brand on the standee — with the sponsor credited, not co-branded. When the sponsor leaves, the merchants stay.
- **Get everything signed and onboarded before February 2027.** After the resignation deadline the political calendar takes over completely and nothing gets decided until late 2027.
- **Don't name the county programme after the county.** "Mombasa Everyday Rewards" hands the asset to whoever runs the county next. Keep the brand Akiba, and let the county take the *credit* rather than the *name*.
- **Hedge with Track C.** Transport SACCOs are the least politically volatile of the three and the highest frequency. See below.

---

## 6. Track C is your best idea, and the channel is already occupied

The transport thesis is correct: highest frequency, unavoidable spend, natural daily touchpoint. Two facts make it more attractive than the document knows, and one makes it harder.

**In your favour:**
- Mombasa has roughly **17,000 tuktuks**, and as of the January 2026 framework every operator must belong to a registered SACCO with a minimum of 100 vehicles. Eight SACCOs have been cleared. The aggregation you need has been *legally mandated into existence* eight months ago. That is a gift.
- Only ~4,000 of the 17,000 currently pay their county fees — meaning the SACCOs have a live compliance problem and an incentive to offer members something of value.

**Against you:**
- The county's **KES 200m zero-interest revolving fund** rolled out in July 2026, targeting exactly this group — boda boda and tuktuk operators, disbursed through SACCO membership. **Ziya**, an interest-free microfinance platform, is already named as the county's partner in that channel. You are not walking into an empty room. You're walking in behind someone who is offering capital while you offer rewards.
- The SACCO mandate is coded as *extraction* in operators' minds — registration, stickers, fees, enforcement. Anything arriving through that channel gets read as another levy unless it very obviously puts money in the rider's pocket.

**The fix:** don't compete with Ziya, ride behind them. Rewards attach naturally to a repayment relationship — a rider earning Miles on fares he's already collecting is a better credit risk and a stickier member. Approach the SACCOs with a Ziya-complementary framing, or approach Ziya directly. And lead the rider pitch with the rider's own earn, not the passenger's: the operator should be *making* something from Akiba before you ask him to ask passengers to scan.

---

## 7. The unit economics, out loud

The document has no numbers, so here are mine. Treat these as a template to overwrite, not as findings.

**Per merchant, at KES 500/month, assuming a fully-loaded field rep at ~KES 35,000/month signing ~15 merchants/month (CAC ≈ KES 2,333):**

| Monthly churn | Avg. life | Revenue LTV | LTV/CAC | Payback |
|---|---|---|---|---|
| 5% | 20.0 mo | KES 10,000 | 4.3× | 4.7 mo |
| 7% | 14.3 mo | KES 7,143 | 3.1× | 4.7 mo |
| 10% | 10.0 mo | KES 5,000 | 2.1× | 4.7 mo |
| **12%** | **8.3 mo** | **KES 4,167** | **1.8×** | **4.7 mo** |
| 15% | 6.7 mo | KES 3,333 | 1.4× | 4.7 mo |

Note that payback is fixed at 4.7 months regardless of churn — you recover CAC in month five or you don't recover it. Unproven MSME SaaS at this price point in this market plausibly churns 10–15%/month in year one. **In the 12–15% band the business does not work at all**, and none of these rows yet subtract support cost, QR standee production, M-Pesa collection fees, or any Miles subsidy.

**City-level break-even.** Four field reps, a city lead, two content (Shaif, Bai), and support ≈ KES 450,000/month fully loaded; add KES 150,000 marketing = **KES 600,000/month**. Net of collection fees you keep roughly KES 430 per merchant. Break-even is **~1,400 paying merchants in Mombasa.** At KES 450,000 with no marketing spend it's ~1,050.

That number should reframe the whole plan. 1,400 paying merchants is not "Phase 1." It is a multi-year outcome for a KES 500 product. Which means one of these must be true:

- Micro is a **loss-leading acquisition tier** and the P&L is carried by Growth-plan upgrades — in which case the strategy needs an explicit Micro→Growth conversion target and the document has none; or
- The real revenue is **breakage and float on the Miles**, not the subscription — in which case say so, model it, and stop describing Akiba as a subscription business; or
- Mombasa is a **funded proof-of-model**, not a P&L, and the deliverable is the playbook. That's a legitimate answer, but then the success metrics should be *evidence quality*, not merchant count.

Pick one. The document currently implies all three.

---

## 8. Your metrics will tell you good news while the thing is failing

The Success Metrics section is comprehensive and almost entirely lagging or gameable.

**Metrics that will lie to you:**
- *Paying merchants* — inflates with subsidised, inactive merchants.
- *Merchant density by ward* — counts merchants, not the merchants a real person actually visits. Ten dukas on one street and none on the next reads as density and isn't.
- *Miles earned* — you control issuance. This measures your generosity, not consumer engagement.
- *QR scans* — counts the attempt, not the completion.

**Missing, and each one is load-bearing:**

- **Personal Merchant Coverage (PMC).** The single best leading indicator you can get. Ask 30 residents of the target ward to list the 10 places they spend money in a normal week, then count how many are live on Akiba. When the median is 3+, density is real. When it's 0–1, no amount of content will save you. This is a 90-minute street survey, repeatable monthly, and it beats every supply-side count in the document.
- **Scan success rate.** Of attempts to earn, what fraction results in Miles credited within 10 seconds? Every failure is a consumer learning that Akiba doesn't work.
- **Miles redeemed ÷ Miles issued**, and the **breakage rate**. Your liability, and probably your revenue.
- **Days from merchant signup to first consumer scan.** If this exceeds ~21 days, that merchant will churn. It's your earliest churn predictor and it's cheap to instrument.
- **Redemption inventory depth** — number of live, in-stock redemption options per Miles tier. See below.
- **Merchant-funded rewards budget as % of merchants** — how many merchants are putting their own money in. That's the only real signal that they believe.

---

## 9. Nothing in the document says why this is defensible

Phase 5 describes merchants competing on Akiba, which is a good end-state. It doesn't explain why Akiba is the venue.

Merchants are non-exclusive. A duka will run Akiba, a competitor, and Bonga Points simultaneously — it costs them nothing. So merchant count is not a moat. If the Mombasa model works and you publish it as a playbook, the people best positioned to copy it are Safaricom, a bank, and Ziya, all of whom have distribution you don't.

The only defensible asset in this plan is the one the document treats as a decorative bullet list: **redemption inventory.**

The consumer promise is *earn on needs, redeem on wants*. The wants — restaurants, fashion, electronics, experiences, entertainment — are the reason to earn at all. If a consumer accumulates Miles and finds nothing worth having, the entire earn side becomes pointless overnight. Conversely, exclusive, genuinely desirable redemption supply is hard to replicate, gets *cheaper* per unit as your consumer base grows, and is the thing a competitor cannot copy by writing a cheque to merchants.

**The fix:** treat redemption supply as a Phase 1 workstream with its own owner and its own targets, not as a Phase 5 consequence. Before you sign the 200th earn-side merchant, you should have a headline redemption partner — one restaurant group, one electronics retailer, one experience — that makes a Mombasa consumer say *"I want that."* The strategy is currently 90% supply-side and the moat is entirely on the other side.

---

## 10. What would prove this wrong — and the one thing to do first

The plan has no falsification condition. Add one, because a city-level thesis is exactly the kind of thing that consumes eighteen months before anyone admits it isn't working.

**The thesis is wrong if,** in a single saturated ward with 150+ live merchants and active consumer marketing:

- Median Personal Merchant Coverage stays below 3 of 10, **or**
- Weekly-active consumers in that ward stay under 15% of downloads after 8 weeks, **or**
- Merchant-funded rewards budgets stay under 20% of merchants at renewal, **or**
- Redemption rate on issued Miles stays under 25% at 90 days.

Any two of those together and the answer isn't "more merchants" — it's that everyday-spend loyalty doesn't clear the habit bar in this market at this price, and the product needs to change shape before the network gets bigger.

**The first thing to do is not Phase 1.** It's a four-to-six week ward experiment, self-funded, before you sign anything political:

1. Pick one island ward. Sign 60–80 merchants **manually and at full price** — no subsidy, no institution. If you cannot sell 60 merchants at KES 500 with a founder in the room, the institutional tracks will not fix that; they'll just hide it.
2. Weight the merchant mix toward high-margin, discretionary-repeat categories. Barber, coffee, kinyozi, pharmacy, restaurant.
3. Secure one aspirational redemption partner before you launch to consumers.
4. Run consumer acquisition in that ward *only*, concurrently.
5. Measure PMC, scan success rate, signup-to-first-scan, and redemption rate.

That experiment costs a fraction of the full plan, and it answers the two questions the entire strategy rests on — *will merchants pay* and *will consumers form the habit* — before you spend political capital that you only get to spend once, in a window that closes in February 2027.

---

## What I'd keep, unchanged

To be clear about what's working:

- The **institutional-distribution insight** is the right answer to merchant CAC. Fix the geography, keep the mechanic.
- **Track C** is the best idea in the document and the timing is unusually good.
- **Micro as adoption-maximising rather than ARPU-maximising** is correct, provided you're honest that it's a loss-leader and name the thing that pays for it.
- **Phase 5's competitive dynamic** — merchants shifting from *should I join* to *what can I offer* — is a real and well-observed end-state. It's just further away than the document implies, and it only arrives after the consumer side is proven.
- **The playbook framing** in Long-Term Vision is the right way to think about why Mombasa matters. Lean into it: if Mombasa's job is to produce a repeatable playbook, then rigorous measurement *is* the deliverable, and that should change what you optimise for in Phase 1.

---

## Sources

- [MiniMiles × MiniPay Week 3 Raffle Report](computer:///Users/ibraziz21/Desktop/Work/MiniMiles/AkibaMiles_MiniPay_Week3_Report.pdf) — retention and loyalty figures
- [IEBC gazettes 2027 election period, unveils key timelines](https://citizen.digital/article/iebc-gazettes-2027-election-period-unveils-key-timelines-for-aspirants-and-campaigns-n388705) — election period commenced 20 Aug 2026; poll 10 Aug 2027; public officer resignation 10 Feb 2027
- [Battle on NG-CDF legality heads to Supreme Court](https://www.citizen.digital/article/battle-on-ng-cdf-legality-heads-to-supreme-court-after-respondents-file-notice-of-appeal-n377040) — Court of Appeal upheld the Act 6 Feb 2026; Supreme Court appeal pending
- [Mombasa sets January deadline for tuk-tuk operators' SACCO registration](https://eastleighvoice.co.ke/coast/247962/mombasa-sets-january-deadline-for-tuk-tuk-operators'-sacco-registration) — ~17,000 tuktuks, ~4,000 compliant, 100-vehicle SACCO minimum, 8 SACCOs cleared
- [Mombasa county's Sh200m revolving fund to be rolled out next month](https://www.the-star.co.ke/counties/coast/2026-06-29-mombasas-sh200m-revolving-fund-to-be-rolled-out-next-month) — KES 200m fund, SACCO-gated, Ziya named as county partner
- [Kenya Now Has 93 Smartphones for Every 100 Phones](https://techweez.com/2026/04/07/kenya-smartphones-penetration-feature-phone-decline/) — 92.9% smartphone penetration, Dec 2025
