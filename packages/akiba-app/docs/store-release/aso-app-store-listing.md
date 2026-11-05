# Akiba App Store optimisation

Kenya storefront baseline, verified 5 November 2026. [Live App Store listing](https://apps.apple.com/ke/app/akiba-app/id6826160217)

| Field | Live on version 1.0 | Proposed for the next version |
|---|---|---|
| Name | Akiba App | Akiba: Local Places & Offers |
| Subtitle | Local shopping. More rewarding | Deals & vouchers in Kenya |
| Primary category | Shopping | Shopping |

The storefront displayed Akiba Holdings, LLC and had zero ratings in the Kenya lookup. The live description already confirms nearby discovery, merchant offers, the Akiba Pass and vouchers. The revised copy puts finding local places first, in line with the [Play Store positioning](./aso-play-listing.md). Confirm the live localization and existing private keyword field in App Store Connect before replacing them.

## Copy for App Store Connect

**Name (28 of 30 characters)**

```text
Akiba: Local Places & Offers
```

**Subtitle (25 of 30 characters)**

```text
Deals & vouchers in Kenya
```

**Keywords (78 of 100 bytes)**

```text
nairobi,near me,discount,coupon,cafe,shops,akibamiles,merchant,specials,redeem
```

This first pass targets local discovery, discounts and the AkibaMiles brand. Search volume and rankings for these terms in the Kenya App Store are unverified. Recheck the merchant footprint before using Nairobi in the keyword field.

**Promotional text (145 of 170 characters)**

```text
Akiba is now on iPhone. Find local shops and cafés in Kenya, see what’s on offer and show your Akiba Pass to collect Miles on eligible purchases.
```

**Description**

```text
Find local shops and cafés in Kenya, see what’s on offer and collect AkibaMiles on eligible purchases at participating businesses.

FIND PLACES NEAR YOU
Explore shops, cafés and services in the Akiba network. See merchant offers and verified visits from the Akiba community before you decide where to go.

COLLECT MILES WITH YOUR AKIBA PASS
When you pay at a participating business, open your Pass and show the QR code to the cashier. Eligible purchases earn AkibaMiles. Check your Miles balance and activity in the app.

TURN MILES INTO VOUCHERS
Exchange AkibaMiles for available vouchers from participating businesses. Open your vouchers in Akiba to see where and how to use them.

Akiba is available in Kenya. Earning and redemption depend on participating merchant offers and voucher terms. AkibaMiles can be exchanged for eligible vouchers through Akiba.
```

## Rollout

1. Update promotional text in App Store Connect while the launch is fresh. Apple allows this field to be edited independently of a version submission. [Apple product page guidance](https://developer.apple.com/app-store/product-page/)
2. Enter the name, subtitle, keywords and description on the next editable iOS version. Confirm name availability and the locale, and record Product sign-off in the release notes before submission. [App information](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information) · [Platform version information](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information)
3. Use the [existing iOS artwork](../../store-assets/ios/README.md) to preview a first-three sequence of Explore, Offers and Akiba Pass. It tells the story in order: find a place, see a reason to go, then show your Pass when you pay. Use the owned-voucher screen next if it fits the uploaded set. [App Store search guidance](https://developer.apple.com/app-store/search/)
4. Save a Kenya baseline in App Analytics before the version goes live. Compare weekly App Store Search impressions, first-time downloads and conversion rate. Spot-check `akiba`, `akibamiles`, `local offers`, `offers near me` and `nairobi deals` on an iPhone using the Kenya storefront. Record the date and storefront for each check. [App Store search performance](https://developer.apple.com/app-store/search/)

The public Akiba homepage still advertises an iOS waitlist. Replace that call to action and the FAQ copy with the confirmed App Store link as a separate website update. [Akiba homepage](https://www.akibamiles.com/)
