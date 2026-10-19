// GET /.well-known/apple-app-site-association
//
// Serves the Apple App Site Association file that makes iOS Universal Links
// open the native app instead of Safari. Paired with
// `ios.associatedDomains: ["applinks:pass.akibamiles.com"]` in the app's
// app.json — the entitlement names the host, this file is what the host
// says back, and both must agree or the links silently stay in the browser.
//
// A route rather than a file in public/ because the Apple Team ID is not a
// value that belongs in Git (the release checklist keeps credential owners
// in the private ops runbook). While APPLE_TEAM_ID is unset this 404s,
// which is the honest answer: nothing is claiming those links yet. Shipping
// a placeholder would be worse — iOS caches a fetched association, so a
// wrong one can keep the feature broken after the real value lands.
//
// `components` deliberately mirrors the Android intent filters: only the
// paths the app renders faithfully. A link to /games or /me/settings has no
// native screen, so it must keep opening in the browser.
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const BUNDLE_ID = "com.akibamiles.akiba";

const CLAIMED_PATHS = ["/merchants/*", "/vouchers/*"];

export async function GET() {
  const teamId = process.env.APPLE_TEAM_ID?.trim();
  if (!teamId) {
    return new NextResponse(null, { status: 404 });
  }

  const body = {
    applinks: {
      details: [
        {
          appIDs: [`${teamId}.${BUNDLE_ID}`],
          components: CLAIMED_PATHS.map((path) => ({ "/": path, comment: "Opens in the Akiba app" })),
        },
      ],
    },
  };

  // Apple requires application/json and no extension on the path. The file
  // is public and identical for every caller, so it can be cached — but
  // briefly, so a corrected Team ID propagates in minutes not days.
  return NextResponse.json(body, {
    headers: { "Cache-Control": "public, max-age=300, s-maxage=300" },
  });
}
