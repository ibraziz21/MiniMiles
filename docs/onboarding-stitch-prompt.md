# Akiba onboarding — Google Stitch prompts

Agreed flow: 3 intro slides → email → code → profile → location primer →
notifications primer → Pass ready (with optional welcome voucher).

The welcome voucher (25% off, valid 7 days from sign-up) is **not live yet**.
Screen 9 is designed in two variants so the app can ship without it and switch
it on behind a flag.

Use prompt 1 first to set the style, then prompts 2–4 as follow-ups in the
same Stitch project so the screens stay consistent.

---

## Prompt 1 — Style + intro slides (screens 1–3)

```
Design a mobile app onboarding for "Akiba", an app for people in Kenya to find
local places to shop, eat and enjoy, and get something back when they spend
there. iPhone frame, light mode.

Visual style:
- Soft background gradient from very pale teal (#EAF7F9) at the top to warm
  off-white (#FCFCFC) at the bottom, with a faint warm cream glow.
- Hand-drawn black ink line illustrations (loose pen sketch, slight
  cross-hatching), with small flat teal (#238D9D) accents only. Characters are
  everyday Kenyan city people. No 3D, no gradients inside illustrations.
- Typography: DM Sans only. Headlines very large and bold (about 40pt),
  near-black (#0D0E0C), two short lines, left-aligned. Body 16pt in #504C4C,
  with one or two key words in bold.
- Primary button: full-width pill, teal #238D9D, white bold label. Secondary
  actions are plain text links.
- Progress: three thin horizontal bars across the top; the current one is
  ink, the others light grey (#E2E2E2). "Skip" text link top-right.
- Generous whitespace, calm and friendly, not childish. No cards on these
  screens.

Screen 1 — headline "Find places worth going to". Body: "Discover **local
spots** to shop, eat and enjoy near you." Illustration: a person walking down
a street of small shopfronts and a café, looking at their phone, a few map
pins floating above.

Screen 2 — headline "Get something back". Body: "**Offers and vouchers** at
the places you already spend." Illustration: a person at a market stall or
café counter receiving a small ticket-shaped voucher with a teal % mark.

Screen 3 — headline "One Pass, every place". Body: "Show your **QR Pass**, the
merchant scans it, done." Illustration: a phone showing a QR code held toward
a smiling shop owner holding a scanner.

Bottom of every slide: primary button "Get started", and under it a text link
"Already have an account? **Sign in**".
```

## Prompt 2 — Account (screens 4–5)

```
Using the same Akiba style, design two sign-in screens. Keep the gradient
background and DM Sans. No illustrations, just a small ink line doodle of an
envelope near the headline.

Screen 4 — Email. Back arrow top-left. Headline "What's your email?" Body:
"We'll send you a 6-digit code. No password needed." One rounded text field
labelled "Email address" with placeholder "you@example.com". Full-width teal
pill button "Send code". Text link "Use a password instead". Small grey legal
line at the bottom: "By continuing you agree to the Terms of Use and Privacy
Policy. We'll create your account the first time you sign in."

Screen 5 — Code. Back arrow. Headline "Enter your code". Body: "Sent to
amina@example.com" with the email in bold and a "Change" link. Six separate
rounded digit boxes in a row, the active one with a teal border. Below:
"Resend code in 0:24" in grey. Teal pill button "Verify".
```

## Prompt 3 — Setup (screens 6–8)

```
Same Akiba style. Three setup screens after sign-in, with a slim teal
progress bar at the top showing 1 of 4, 2 of 4, 3 of 4.

Screen 6 — Profile. Headline "Set up your profile". Fields: "Username" (with a
small "@" prefix), "Country" shown as a fixed, non-editable row reading
"Kenya" with hint "Akiba is live in Kenya for now", and "City" with
placeholder "e.g. Nairobi". Teal pill button "Continue".

Screen 7 — Location primer. Ink line illustration of a person with a map and
a few teal pins around them. Headline "See what's near you". Body: "We use
your location to show places and offers close by. You can change this
anytime." Teal pill button "Allow location", text link "Not now".

Screen 8 — Notifications primer. Ink line illustration of a phone with a small
teal notification bubble showing a % tag. Headline "Never miss an offer".
Body: "Get a heads-up when a place you like has something for you." Teal pill
button "Turn on notifications", text link "Not now".
```

## Prompt 4 — Pass ready (screen 9, two variants)

```
Same Akiba style. Final onboarding screen, progress bar 4 of 4. Make two
variants side by side.

Variant A (no welcome gift) — Headline "Your Pass is ready". A white card
with soft shadow and rounded corners showing a large QR code, the member's
name "Amina W." and "@amina" under it. Tip below the card with a small info
icon: "Show this when you pay so the place can scan it." Teal pill button
"Start exploring".

Variant B (welcome gift) — Headline "Welcome to Akiba". Above the Pass, a
voucher-shaped card (ticket edges with semicircle notches, teal #238D9D
background, white text): big "25% OFF", line "Your welcome voucher", and a
small white pill reading "Expires in 7 days". A subtle ink line confetti
doodle around it. Below, a smaller version of the Pass QR card with the tip
"Show your Pass when you pay to use it." Teal pill button "Find a place to
use it", text link "Start exploring".
```

---

## Notes for implementation

- DM Sans is the only production-cleared typeface, so the serif headlines in
  reference image 3 are replaced with bold DM Sans.
- The copy avoids "loyalty" and "earn rewards" framing; any AkibaMiles amount
  is shown as [icon]amount.
- The welcome voucher needs backend work before Variant B can ship: issuing
  the voucher at sign-up, the 7-day expiry, which merchants accept it, and a
  feature flag the app reads from config.
