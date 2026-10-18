# EAS configuration — what is set, and what is still blocked

Companion to `eas.json`. AKIBA-MOB-002 §11. JSON has no comments, so the
reasoning lives here.

## What `eas.json` sets, and why

| Setting | Value | Reason |
|---|---|---|
| `cli.appVersionSource` | `remote` | §11.4 — EAS owns `ios.buildNumber` and `android.versionCode`. `expo.version` in `app.json` stays the member-visible release version, and the `/api/v1/config` minimum/latest gate compares *that*, never a build number. |
| `cli.requireCommit` | `true` | §11.2 — a production build must come from a clean commit. EAS applies this to every profile, which is stricter than the spec asks and the right default. |
| `build.development` | standalone internal APK, `development` env | Expo Go and the Expo development launcher are not used. Local native work uses `expo run:android`; shared builds open directly as Akiba. |
| `build.preview` | internal APK, `preview` env | Installable QA binary. Preview must never point at production mutation endpoints. |
| `build.production` | store AAB, `production` env, `autoIncrement` | The Play artifact is explicitly an Android App Bundle and cannot open the Expo development launcher. |
| Node runtime | `22.13.0` in every profile | Matches `.nvmrc` and `package.json` instead of inheriting a moving EAS default. |
| `submit.production.android.track` | `internal` | A first submission cannot accidentally go directly to the public production track. Promotion remains a Play Console decision. |

EAS Update is **not** configured. `app.json` sets `updates.enabled: false`
(§11.4), and no channel or runtime policy appears in any profile, because a
channel on a build is only meaningful once an update, rollback and
code-signing policy is approved.

The app is linked to `@akiba-holdings-llc/akiba` with EAS project ID
`b0a8fd39-ca2d-4ec7-91f9-30537b945ef0`.

## Blocked — needs a decision or an account, not code

These are left absent rather than filled with plausible-looking values. A
wrong bundle identifier is immutable after publication, and a wrong submit
binding uploads a build to the wrong listing.

- **`submit.production.ios`** — needs `appleId`, `ascAppId` and
  `appleTeamId` from the App Store Connect record.
- **Play submission credentials** — a Google service-account key must be
  attached in EAS/Play Console and kept outside Git. The checked-in submit
  profile deliberately targets only the internal track.

## Environment variables

Three public values per environment (§11.3), created in EAS, never committed:

```text
EXPO_PUBLIC_SUPABASE_URL
EXPO_PUBLIC_SUPABASE_ANON_KEY
EXPO_PUBLIC_API_BASE_URL
```

Rules enforced by `scripts/validate-production-build.mjs` during every
production EAS build:

- required public variables are present;
- production URLs are HTTPS, contain no credentials, and the API uses an
  `akibamiles.com` host;
- localhost, the Android emulator loopback and `*.local` Supabase URLs are
  rejected;
- the release identifiers are no longer marked as placeholders;
- `expo.owner` and `extra.eas.projectId` exist;
- production remains an AAB, never a development client, and first submit is
  constrained to Play internal testing;
- `expo-dev-client` is absent, and storage / overlay permissions stay blocked
  from the Android manifest;
- the 1024px app/adaptive/monochrome icons and disabled OTA-update policy are
  intact.

Operational rules when the environments are created:

- preview never points at production mutation endpoints;
- every `EXPO_PUBLIC_` value is public information by definition — no
  service-role key, SMTP credential, signing key, Platform service secret, or
  store credential may be added to this list;
- CI prints variable *names* and the selected environment, never values.

`src/api/client.ts` and `src/auth/supabase.ts` also retain runtime guards. The
EAS post-install hook catches release mistakes before native compilation, so a
bad production environment now fails the build instead of producing a broken
store artifact.

## Android release sequence

After the EAS production environment and Play credentials are ready:

```bash
pnpm dlx eas-cli@latest env:exec --environment production \
  'pnpm release:check'
pnpm dlx eas-cli@latest build --platform android --profile production
pnpm dlx eas-cli@latest submit --platform android --profile production
```

The resulting AAB goes to Play internal testing. Promote that same reviewed
artifact only after the device matrix, Play pre-launch report, privacy forms,
listing and reviewer access are complete.
