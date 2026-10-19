// GET /.well-known/assetlinks.json
//
// Android's half of app-link verification, paired with the `autoVerify`
// intent filters in the app's app.json. Android fetches this at install
// time; if it is missing or the fingerprint does not match the installed
// APK's signing certificate, the filters stay unverified and links keep
// opening in Chrome.
//
// Same reasoning as the Apple file next door: the signing-certificate
// fingerprint comes from whoever holds the upload/app-signing key (EAS, via
// `eas credentials`), not from Git, so this 404s until it is configured.
//
// ANDROID_CERT_SHA256 accepts one or more colon-separated SHA-256
// fingerprints, comma-separated. More than one is normal and worth
// supporting: Play App Signing re-signs the upload artifact, so the
// fingerprint that verifies an internal-track build is usually different
// from the local upload key's, and both need to be listed during rollout.
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const PACKAGE_NAME = "com.akibamiles.akiba";

const FINGERPRINT_RE = /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/;

export async function GET() {
  const configured = process.env.ANDROID_CERT_SHA256?.trim();
  if (!configured) {
    return new NextResponse(null, { status: 404 });
  }

  const fingerprints = configured
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter((value) => FINGERPRINT_RE.test(value));

  // A malformed fingerprint would produce a file Android rejects wholesale.
  // Refusing to serve it keeps the failure legible in logs instead of
  // looking like a mysteriously unverified app link.
  if (fingerprints.length === 0) {
    console.error("[assetlinks] ANDROID_CERT_SHA256 is set but contains no valid SHA-256 fingerprint");
    return new NextResponse(null, { status: 404 });
  }

  const body = [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: PACKAGE_NAME,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];

  return NextResponse.json(body, {
    headers: { "Cache-Control": "public, max-age=300, s-maxage=300" },
  });
}
