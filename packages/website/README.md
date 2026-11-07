# AkibaMiles Website

Public marketing site for AkibaMiles.

## Local Development

```bash
pnpm --filter @akibamiles/website dev
```

Next.js will use its default port unless one is provided at runtime.

## Environment

Copy `.env.template` to `.env.local` for local development.

```bash
NEXT_PUBLIC_SITE_URL=https://www.akibamiles.com
NEXT_PUBLIC_APP_URL=https://app.akibamiles.com
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
PARTNER_LEAD_IP_HASH_SALT=
```

`TURNSTILE_SECRET_KEY` is required in production for partner lead submissions.


## Smart app download link

Print the QR from `public/app/download-qr.svg` or encode
`https://akibamiles.com/download`. Deploy this website before printing it.

The route issues an uncached 302 to the App Store on iOS and Google Play on
Android. Desktop visitors, unidentified devices, desktop-mode iPads and known
preview bots go to `/download/options`, which has both store buttons. Explicit
store choices work on every device.

Campaign examples:

- `https://akibamiles.com/download?source=merchant&ref=arabica`
- `https://akibamiles.com/download?source=merchant&ref=flame`
- `https://akibamiles.com/download?utm_source=event&utm_medium=qr&utm_campaign=launch`

Accepted tags are `source`, `ref`, `utm_source`, `utm_medium`, `utm_campaign`
and `utm_content`. Values must be 1–100 ASCII letters, digits, hyphens or
underscores. Other query parameters are discarded. Android receives these
campaign values through the Play referrer. iOS uses the existing public
listing without inventing an Apple campaign token.

GET requests emit structured `download_visit` events in the hosting runtime
logs. Export and aggregate these logs to compare campaigns. Retention follows
the host's log settings. These events are requests, including possible bots
and repeat visits, and manual store clicks are separate events. HEAD requests
do not emit events. No IP address or full user agent is included in the event.

Confirmed install conversion requires additional mobile instrumentation.
The route currently sends visitors to stores even if Akiba is installed.
The QR on the fallback page is the general download URL and starts a fresh
untagged request when scanned from another device.
