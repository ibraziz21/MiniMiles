# EAS configuration — what is set, and what is still blocked

Companion to `eas.json`. AKIBA-MOB-002 §11. JSON has no comments, so the
reasoning lives here.

## What `eas.json` sets, and why

| Setting | Value | Reason |
|---|---|---|
| `cli.appVersionSource` | `remote` | §11.4 — EAS owns `ios.buildNumber` and `android.versionCode`. `expo.version` in `app.json` stays the member-visible release version, and the `/api/v1/config` minimum/latest gate compares *that*, never a build number. |
| `cli.requireCommit` | `true` | §11.2 — a production build must come from a clean commit. EAS applies this to every profile, which is stricter than the spec asks and the right default. |
| `build.development` | dev client, internal, `development` env | The app already depends on `expo-secure-store`, `expo-location` and `expo-glass-effect`, so Expo Go cannot run it; `expo-dev-client` is installed for this profile. |
| `build.preview` | internal, `preview` env | §11.3 — preview must never point at production mutation endpoints. Enforced by the EAS environment's variable values, not by this file. |
| `build.production` | store, `production` env, `autoIncrement` | §11.4 — reproducible build/version increments. |
| `submit.production` | `{}` | Intentionally empty — see below. |

EAS Update is **not** configured. `app.json` sets `updates.enabled: false`
(§11.4), and no channel or runtime policy appears in any profile, because a
channel on a build is only meaningful once an update, rollback and
code-signing policy is approved.

## Blocked — needs a decision or an account, not code

These are left absent rather than filled with plausible-looking values. A
wrong bundle identifier is immutable after publication, and a wrong submit
binding uploads a build to the wrong listing.

- **`expo.owner` and `extra.eas.projectId`** (§11.1) — require the Expo
  organization account. `eas init` writes them once that account exists.
- **`submit.production.ios`** — needs `appleId`, `ascAppId` and
  `appleTeamId` from the App Store Connect record.
- **`submit.production.android`** — needs `serviceAccountKeyPath` for a key
  that must live outside Git, plus the release track.
- **Final bundle identifier / package name** (§11.1, §20) — `app.json` still
  carries `com.akiba.pass` and keeps its
  `extra.configurationNotes.bundleIdentifiersArePlaceholders` marker. The
  marker is deliberately *not* removed yet: deleting it while the value is
  still a guess would hide a launch blocker instead of clearing it.

## Environment variables

Three public values per environment (§11.3), created in EAS, never committed:

```text
EXPO_PUBLIC_SUPABASE_URL
EXPO_PUBLIC_SUPABASE_ANON_KEY
EXPO_PUBLIC_API_BASE_URL
```

Rules that still need enforcing when the environments are created:

- production URLs are HTTPS and point only at production;
- preview never points at production mutation endpoints;
- every `EXPO_PUBLIC_` value is public information by definition — no
  service-role key, SMTP credential, signing key, Platform service secret, or
  store credential may be added to this list;
- CI prints variable *names* and the selected environment, never values.

`src/api/client.ts` already throws when `EXPO_PUBLIC_API_BASE_URL` is absent,
and `src/auth/supabase.ts` throws when either Supabase value is absent, so a
build missing required public configuration fails at startup rather than
silently pointing somewhere unintended. The §17 criterion "production builds
fail closed when required public configuration is absent **or points to a
non-production host**" is only half met by that: the host check needs a
production-environment assertion that does not exist yet.
