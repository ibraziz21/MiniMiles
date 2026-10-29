# Akiba iOS launch assets

## Capture session

Enable `EXPO_PUBLIC_SCREENSHOT_MODE=true` in the ignored `.env.local`, then
restart Metro with its cache cleared. This supplies commerce fixtures only:
offers, voucher catalogue, voucher state, owned vouchers, and the home Miles
balance. Authentication and merchant discovery still use the configured backend.
Use a dedicated screenshot account and check every capture for personal data.
The Pass screen also substitutes a fictional member and a non-redeemable QR
while screenshot mode is enabled.

The production build validator rejects screenshot mode. Disable the local flag
after the capture session, before preparing a release.

Keep unedited iPhone captures in `raw/` and exported artwork in `exports/`.
Capture the actual iOS interface; the Android captures are reference material.

## Screenshot story

| File | Screen | Headline |
| --- | --- | --- |
| 01-explore.png | Explore | Find your next local favourite |
| 02-merchants.png | Merchants | Good places, closer to you |
| 03-merchant.png | Merchant detail | Get to know a place before you go |
| 04-pass.png | Akiba Pass | Your pass to more rewarding shopping |
| 05-offers.png | Offers | Discover what’s on offer |
| 06-rewards.png | Owned vouchers | Keep your rewards close |
| 07-free-offers.png | Free offers | Find your next treat |
| 08-shop.png | Miles catalogue | Turn Miles into rewards |

Use Akiba teal, the existing brand typography, short headlines and prominent
real UI. Sample data must reflect available release features. Confirm the
supported screenshot slots in App Store Connect before exporting final artwork.

## Header and search creative

Create a shared visual direction around local discovery and rewards, with the
Akiba brand and real iOS screens. Keep important artwork centered within Apple's
template safe areas. Do not include store badges, URLs, prices or unverified claims.

Apple specifications checked 26 October 2026:

- Product page header: 3840 × 1646 (21:9).
- Search results: 1920 × 1280 through 3840 × 2560 (3:2).
- Universal alternative for both: 5244 × 2950 PNG; use Apple's universal template.
- Creative images must have no alpha channel or transparency.

Sources:
- https://developer.apple.com/help/app-store-connect/reference/app-information/creative-assets-specifications
- https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications
- https://developer.apple.com/app-store/asset-best-practices/

## Capture status — 26 October 2026

Ten raw PNGs are saved in `raw/`, captured from iPhone 17 Pro on iOS 26.5.
Each is 1206 × 2622 pixels. The status bar is standardized to 09:41, the
development warning is dismissed, and the Pass uses fictional member details.
Merchants and merchant content are from the configured backend; commerce
content uses the screenshot fixtures. Lint and TypeScript checks pass.

The AppScreens project is https://appscreens.com/user/project/5yNKpoLRQxbKzQrcloLX
and currently uses the iPhone with Dynamic Island (medium) output slot.
The new captures have not been imported into that project.

## Local artwork exports

Five styled, watermark-free screenshots are now in `exports/`, ordered for upload.
Each PNG is 1206 × 2622, sRGB, opaque RGB. `preview.png` shows the full set.
`akiba-app-store-screenshots.zip` contains only the five upload PNGs.

Editable, self-contained HTML sources are in `layouts/`. Regenerate with
`node render-assets.cjs` using Playwright and Sharp from your Node environment.
Set `NODE_PATH` if those dependencies are not installed locally; optionally set
`CHROMIUM_EXECUTABLE_PATH` to your installed Chromium binary. Original captures
are embedded without changing their UI, with CSS device frames and brand fonts.

## Header and search exports

`creative/header.png` is 3840 × 1646; `creative/search-results.png` is
3840 × 2560. Both are opaque sRGB PNGs, with matching teal branding and
the original Explore/Rewards captures. `creative/preview.png` shows both.
Editable HTML is alongside the PNGs; regenerate with `node render-creative.cjs`
using the same runtime settings as the screenshot renderer.

Check the placement previews in App Store Connect before submitting, since
Apple can crop creative differently across placements. An optional preview
video remains outstanding.
