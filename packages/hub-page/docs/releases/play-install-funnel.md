# Play install funnel rollout

The website uses Google's supplied English PNG badge (646 × 250), downloaded
unchanged from https://play.google.com/intl/en_us/badges/static/images/badges/en_badge_web_generic.png.
Marketing links and hub links encode `utm_source`, `utm_medium=web` and the
placement as `utm_campaign` inside Play's `referrer` parameter.

## Production configuration

On Vercel project `mini-miles-hub-page`, `MOBILE_STORE_URL_ANDROID`,
`APPLE_TEAM_ID` and the user-supplied Play App Signing `ANDROID_CERT_SHA256`
were added to Production on 4 November 2026. A deployment is still required
to activate them:

- `ANDROID_CERT_SHA256`: the **Play App Signing** SHA-256 fingerprint from
  Play Console → Protected with Play → Play Store protection → Play App Signing. Do not substitute the upload key.
  The association route accepts multiple comma-separated fingerprints.
- `APPLE_TEAM_ID`: verify the release team's value (app.json currently records
  `6DQJX4ZG84`) and configure the Apple association route.
- `MOBILE_STORE_URL_ANDROID`: `https://play.google.com/store/apps/details?id=com.akibamiles.akiba`.
  This must match `PLAY_STORE_URL` in the web link helper; `.env.example` documents it.

The install CTAs work independently of App Link verification. Verification is
needed for installed apps to receive merchant/voucher links. No installed-app
detection is implemented: Android prompts may appear to existing app users.
Dismissal snoozes the banner and home nudges for 14 days; standalone PWA mode
suppresses them. Browser PWA installation remains available.

## Checks after deployment

- Fetch `/.well-known/assetlinks.json` and
  `/.well-known/apple-app-site-association`; check actual production identities.
- Reinstall from Google Play and verify a merchant URL opens the native app.
- Check Android hub signed in/out: banner, home nudge, dismissal after reload,
  and clearance above bottom navigation.
- Check iOS Safari retains Share → Add to Home Screen instructions.
- Check the website app panel, footer and support badge on phone and desktop.
- View served HTML to confirm marketing and public hub Play links are present.
- Check iOS waitlist submission still records `website_ios_waitlist`.

`track()` remains a production no-op. These changes add conventional click
calls but do not deliver click analytics or post-install activation attribution.
Play Console can report tagged store traffic; do not equate it with retained
users. Structured data does not guarantee a Google Search app result, and
there is no established hard ranking cap at zero public ratings.

No dev server or localhost visual verification was run, as requested.
