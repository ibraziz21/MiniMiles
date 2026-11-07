import { NextResponse } from "next/server";
import { downloadCampaign, downloadPlatform, downloadStoreUrl } from "@/lib/download";

export const dynamic = "force-dynamic";

function downloadResponse(request: Request, recordVisit: boolean) {
  const url = new URL(request.url);
  const campaign = downloadCampaign(url.searchParams);
  const choice = url.searchParams.get("store");
  const platform = choice === "ios" || choice === "android"
    ? choice
    : downloadPlatform(request.headers.get("user-agent") ?? "");
  const fallback = new URL("/download/options", url);
  fallback.search = campaign.toString();
  const destination = platform === "unknown" ? fallback.toString() : downloadStoreUrl(platform, campaign);

  if (recordVisit) {
    console.info(JSON.stringify({
      event: "download_visit",
      platform,
      selection: choice === "ios" || choice === "android" ? "manual" : "automatic",
      campaign: Object.fromEntries(campaign),
    }));
  }

  const response = NextResponse.redirect(destination, 302);
  // Device-specific redirects must never be reused for another visitor.
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Vary", "User-Agent");
  return response;
}

export function GET(request: Request) {
  return downloadResponse(request, true);
}

export function HEAD(request: Request) {
  return downloadResponse(request, false);
}
