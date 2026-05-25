# AkibaMiles Website

Public marketing site for AkibaMiles.

## Local Development

```bash
pnpm --filter @akibamiles/website dev
```

Next.js will use its default port unless one is provided at runtime.

## Environment

```bash
NEXT_PUBLIC_SITE_URL=https://www.akibamiles.com
NEXT_PUBLIC_APP_URL=https://app.akibamiles.com
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
```

`TURNSTILE_SECRET_KEY` is required in production for partner lead submissions.
