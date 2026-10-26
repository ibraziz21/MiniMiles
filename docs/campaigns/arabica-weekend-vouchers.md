# Arabica weekend funded vouchers

## Confirmed campaign terms

- Merchant: Arabica Coffee House.
- Benefit: 10% off the actual bill, capped at KES 200.
- Authorized budget: KES 20,000 (2,000,000 minor units).
- Quantity cap: 100 vouchers, reserving KES 200 per voucher.
- Claim rule mode: all; country_in [KE], profile_country_set, pass_activated,
  no_prior_merchant_redemption.
- Redemption schedule: Saturday/Sunday [6, 0] in Africa/Nairobi, independent of claiming.
- Voucher validity: preserve the selected duration and ensure it reaches the intended weekend. A Monday claim with 48-hour validity expires before Saturday. One claim per member per allocation.
- Receipt/POS reference required at merchant checkout.

The country boundary reads the authenticated member's saved profile country
and rechecks it inside the database transaction. Missing or non-KE profiles
fail closed, regardless of the country supplied in a request. This is a
self-declared profile-country restriction, not nationality or location verification.

## Confirmed campaign window

Minimum bill: KES 300. Campaign: 31 October through 29 November 2026,
Africa/Nairobi. Claim window: 2026-10-31T00:00:00+03:00 through
2026-11-30T00:00:00+03:00 (exclusive end). Confirmed by the user in this chat.
These settings have not been published to the live database.

## Discovery and launch

Web member and visitor Discover pages show funded offers above Business offers.
The mobile home endpoint supplies fundedOffers; updated mobile clients show the
same section. Weekend wording is derived from the stored weekday rule, not the
merchant name. Web links open /vouchers?tab=claimable and target the offer card;
mobile links open /vouchers?tab=claim.

The configured Supabase database checked during implementation contained three
older Henna allocations (ended/exhausted) and no Arabica allocation. No live
allocation was created or published as part of this UI change.

Before launch:

1. Use the confirmed minimum bill and campaign dates above.
2. Apply Platform 151 and 152 plus MiniMiles 110, and deploy the Platform API
   weekday-rule evaluator and the web changes.
3. Create the Kenya program and allocation through the authenticated admin
   authoring workflow using the confirmed terms; approve and publish them.
4. Enable AKIBA_FUNDED_VOUCHERS_HUB_ENABLED in Hub and Platform deployment
   environments. It defaults to off; local Hub configuration was unset.
5. Release the compatible mobile build before enabling
   AKIBA_PERCENT_FUNDED_OFFERS_V1_ENABLED. Old mobile contracts cannot parse
   percentage offers, so this compatibility gate remains in the home endpoint.
6. Verify a real Arabica scan, bill entry, receipt reference, capped discount,
   and reimbursement payable before launch.

Automated verification includes real-Postgres assertions rejecting UG, TZ and
missing profile countries despite a caller-supplied KE, and the 100 × KES 200
commitment floor. These tests do not create production campaign inventory.
