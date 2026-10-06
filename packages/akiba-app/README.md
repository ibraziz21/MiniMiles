# Akiba Pass native app

`@akiba/akiba-app` is the Expo/React Native application described in the
[Hub mobile migration plan](../hub-page/docs/hub-mobile-app-migration-plan.md).
The initial store rollout is Kenya-only, and Games are deliberately excluded.

## Why one package

The migration plan originally separated the app, API contracts, API client,
and native UI into four packages. The scaffold keeps them together here under
`src/` so every native dependency is installed directly in the application
package and remains visible to Expo Autolinking.

```text
src/
├── api/              typed mobile API client
├── app/              Expo Router routes
├── auth/             Supabase + SecureStore session foundation
├── components/       app-level native components
├── contracts/        Zod API contracts
└── design-system/    native primitives and Akiba tokens
```

## Current status

This is a navigation and architecture scaffold only:

- five native tabs: Home, Merchants, Vouchers, Pass, and Profile;
- placeholder screens with no business logic;
- Zod contracts for `GET /api/v1/config` and
  `GET /api/v1/me/bootstrap`;
- a typed fetch client with the planned native request headers; and
- Supabase session persistence through `expo-secure-store`.

The `/api/v1/*` routes and dual-auth backend foundation do not exist in
`hub-page` yet. The client methods are intentionally not called by these
placeholder screens and will return `404` until Phase 1 of the migration lands.

## Configuration

Copy `.env.example` to `.env.local` and set:

```text
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
EXPO_PUBLIC_API_BASE_URL=
```

Only client-public values belong in this package. Never add the Supabase
service-role key, platform service keys, cron secrets, VAPID private keys, or
wallet private keys.

The iOS and Android identifiers in `app.json` are placeholders:
`com.akiba.pass`. Replace them during Phase 0 store registration before any
external build.

## Commands

Expo SDK 57 requires Node.js 22.13 or newer. The package pins pnpm 10.26.2.

Run from the repository root:

```bash
pnpm akiba-app:start
pnpm akiba-app:ios
pnpm akiba-app:android
pnpm akiba-app:web
pnpm --filter @akiba/akiba-app exec tsc --noEmit
```
