# Android production bundle — 20 October 2026

Artifact: `dist/releases/akiba-1.0.0-5.aab` (77,946,824 bytes).

- EAS build: [8d9576fa-8e42-4dae-b321-a0726d85ea63](https://expo.dev/accounts/akiba-holdings-llc/projects/akiba/builds/8d9576fa-8e42-4dae-b321-a0726d85ea63)
- Source commit: `812fcd7fdacb96414c115c46c30fb18c1937b06e`.
- Profile/environment: `production`; distribution: `STORE`; package: `com.akibamiles.akiba`.
- Version name/code: **1.0.0 / 5**. Code 4 was reserved by an interrupted upload and is intentionally skipped.
- Production API: `https://pass.akibamiles.com`; production Supabase variables supplied by EAS; screenshot fixture mode off.
- SHA-256: `4a3daade7f6c23a4c041b51d45728b0c6d3b83f832b2243bd0989dba78f2c49e`.

## Artifact verification

- Production preflight, mobile TypeScript/lint and all 124 mobile tests passed before building.
- EAS completed the signed Android App Bundle using the existing remote default upload keystore.
- Google bundletool 1.18.3 validation passed. Manifest target API 36, minimum API 24; debuggable and cleartext traffic disabled.
- JAR signature verified with Java 17 and the Android Studio JDK. SHA-256 upload-certificate fingerprint:
  `B0:86:DB:43:B9:24:BD:BC:62:45:3E:F7:CC:9D:28:94:88:B5:E4:85:84:C0:5A:82:AA:CE:27:DB:E4:00:29:04`.
- All 50 ARM64/x86-64 ELF libraries have PT_LOAD alignment of at least 16 KB. Bundle configuration requests `PAGE_ALIGNMENT_16K` for uncompressed native libraries.
- Manifest has no external-storage, broad photo-library, overlay or microphone permissions. Camera, foreground location, notifications and SecureStore biometric permissions remain present.
- Embedded JavaScript contains the production API endpoint. A framework `localhost` literal also exists; native application source has no localhost endpoint and the production API value is supplied explicitly.
- No Firebase admin service-account or keystore files were found in the bundle. The public Firebase application config is included through Expo prebuild.

Sidecar checksum, manifest, certificate and detailed native-library inspection are saved beside the local AAB. Signing tools emit normal self-signed/no-timestamp notices and an entry-order/JarInputStream warning; JarFile verification and bundletool validation passed. The artifact has not been modified after signing.

## Upload scope and remaining acceptance

Prepared for **Play Console → Internal testing** upload; no Play upload or submission was performed. Play Console acceptance, Play-installed/pre-launch testing, final Data safety declarations, reviewer credentials and disposable-account deletion/email proof remain separate release checks.

The product owner accepted the review risk of launching anonymous community contributions with reporting and admin moderation but without contributor blocking. This bundle does not add blocking or certify UGC-policy compliance.

The root `.easignore` limits uploads to native sources and workspace install inputs. Generated native projects, credentials, web/backend/contract packages and local captures are excluded; EAS regenerates Android configuration from `app.json`.
