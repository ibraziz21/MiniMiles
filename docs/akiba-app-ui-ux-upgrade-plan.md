# Akiba app and Pass UI/UX upgrade plan

This plan records the agreed Stitch direction for Places, Explore, voucher claiming, Rewards, and verified visit sharing. The Pass refresh is a proposed design pass based on the existing native screen. Keep the current business profile layout and design only the entry points and states needed for verified visits and sharing.

## 1. Places and shared business cards

- Rename the consumer-facing Merchants tab and directory to **Places**. Keep existing routes and public profile URLs compatible.
- Put search and filters above a compact list. Use a full-row tap target and a chevron. Show the business name, category, location or shopping mode, and one concrete benefit when the data supports it.
- Use a business banner as a small thumbnail, then a small logo on a plain surface, then a neutral icon. Keep row spacing consistent across the variants. Show distance, earn rates, and offers only when supplied.
- Keep category, city, shopping mode, active offers, and Near me. Open the filter sheet with current selections. Apply closes the sheet, updates the results and filter count, and preserves the query. In the empty state, **Clear filters** preserves the query and **Clear search** is a separate action. Drop the mockup's Instant Pay label.

## 2. Explore and voucher claiming

Keep search at the top. Submitting a query opens Places with the query applied. The filter button opens the Places filter sheet.

1. **Claimable offers** uses a horizontal carousel with the next card peeking in. Lead with the benefit, business, and key restriction. Use the optional business image as a small brand asset, with a text-led fallback. **Claim** is for in-app claimable offers. **See all** opens Offers.
2. **New on Akiba** uses the shared Places row for businesses published in the last 30 days, newest first. Enforce the cutoff in the feed and enrich the listings with available directory fields. Hide the section when empty.
3. **Verified visits** uses an eligible approved customer photo, business name, and a recommendation or favorite detail when supplied. Label an exact count as verified recommendations. Hide the section when no highlights qualify. Tapping opens the existing business profile on its Verified tab.
4. **Places on Akiba** uses the shared Places row for a short directory preview. Exclude businesses already featured in New on Akiba from this preview. **See all** opens Places.

Open the funded claim sheet over the actual Explore feed. Carry the same benefit, minimum spend, and timing across the carousel, sheet, and voucher. Distinguish a claim deadline from a redemption deadline. Use the current eligibility and claim APIs for checking, blocked, ready, submitting, retry, claimed, and already-claimed states. Confirm intent and show the use-plan picker only when required. Prevent duplicate submission. **View voucher** opens the specific issued voucher. Refresh the offer and Rewards state after success. Keep redemption credentials on voucher detail.

## 3. Rewards, voucher detail, and Pass

- **Rewards** opens on **My vouchers**. Use a compact AkibaMiles balance and retain **Free offers** and **Spend AkibaMiles**. Separate Ready to use, Used, and Expired. Keep Preparing visible with neutral copy. The compact rows lead with benefit, business, status, and relevant date. **View voucher** opens detail. Give the empty wallet routes to free offers and spending AkibaMiles.
- **Free offers** uses the same vocabulary as Explore and distinguishes **Claim by** from **Use by**. **Spend AkibaMiles** shows the actual price and any qualification or balance requirement before confirmation.
- **Voucher detail** prioritizes benefit, status, use-by date, minimum spend, eligible businesses, and relevant restrictions. For multi-business vouchers, explain that it can be used once at any participating business. **Show QR** opens a focused view with the existing live QR, refresh countdown, and “Show this to the cashier before paying.” Keep preparation, validation failure, retry, used, and expired states clear. An expired voucher can lead back to Offers. Preserve live status checks and token behavior.
- **Pass** gets a focused design pass before implementation. Keep the membership QR prominent with one instruction for earning AkibaMiles at participating businesses. Use the voucher QR view as a visual reference while giving Pass its own identity and purpose. Design ready, loading, and retry states around the existing refresh behavior. Preserve the Pass token and validation flow. Verify both QR paths on devices.

## 4. Verified visit management and sharing

Keep the public Verified tab and the member's private visit card as the two entry points. Public visit content retains contextual actions such as Helpful and Report. Eligible members can use the existing contribution flow when enabled.

- **Edit visit** opens a prefilled form for what the member tried, what they recommend, and their note. Label private fields and fields eligible for publication. Show saving, saved, and retry with the draft preserved. Decide how a published recommendation behaves while an edit is under review before implementing updates.
- **Manage photos** shows existing photos, their review status, and individual add and remove actions using current limits. Explain that removing a published photo also removes it from the public visit.
- **Share place** in the profile header shares the real public business URL. Design **Share link**, **Copy link**, and **Story card**. Use the public business banner, then a logo-only layout, then a text fallback. Verify the WhatsApp link preview on devices. Create separate 9:16 Story artwork with space for a link sticker and keep posting instructions outside the artwork.
- **Share my visit** is available on the member's private card when their recommendation is public. A publication prompt can invite them to share a concrete tip with a friend. Preview the published recommendation and optional approved photo before sharing. Offer a text-led layout for visits without a photo. Keep private notes, payment details, and pending media out of shared content.
- A **shared visit link** should open the specific public visit within the business's Verified tab, with a public web destination when the app isn't available. Put the recommendation first and keep Save place secondary. Define what recipients see if a visit is later removed or made private. Confirm the supported Story handoff and link sticker behavior before committing to direct Instagram sharing.

## Implementation order and verification

1. Build the shared row and Places flow. Check search, filter persistence, clear actions, and image fallbacks.
2. Build Explore and the claim sheet. Verify real feed fields, all claim states, retry behavior, and the handoff to the issued voucher.
3. Refresh Rewards and voucher detail. Complete the Pass design and then refresh it. Verify successful scans and failure states on iOS and Android using the appropriate checkout flow for each QR.
4. Add Share place using the existing public link and preview metadata. In parallel with earlier UI work, define visit editing, publication rules, public visit links, and Story artwork delivery. Then ship Share my visit with the receiver experience.
5. Verify the end-to-end paths on both platforms and run native lint and typecheck before shipping. Check phone layouts, large text, tap targets, empty states, QR refresh and expiry, and public share links for signed-out recipients.

Use the approved Stitch exports as visual references. The native design system and live data determine the labels, imagery, actions, and states used in the build.
