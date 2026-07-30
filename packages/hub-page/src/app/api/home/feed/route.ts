import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getHomeFeed } from "@/lib/home/feed";

// Used for the client-side re-fetch after a location grant (initial page
// load calls getHomeFeed directly from the server component). Must reflect
// current directory/voucher state on every request.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const latParam = searchParams.get("lat");
  const lngParam = searchParams.get("lng");
  let lat: number | undefined;
  let lng: number | undefined;
  if (latParam !== null && lngParam !== null) {
    const parsedLat = Number(latParam);
    const parsedLng = Number(lngParam);
    if (
      !Number.isFinite(parsedLat) || !Number.isFinite(parsedLng) ||
      parsedLat < -90 || parsedLat > 90 || parsedLng < -180 || parsedLng > 180
    ) {
      return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 });
    }
    lat = parsedLat;
    lng = parsedLng;
  }

  const intent = searchParams.get("intent") ?? undefined;
  const limitRaw = Number(searchParams.get("limit_per_section") ?? "6");
  const limitPerSection = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 10) : 6;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  try {
    const feed = await getHomeFeed({
      userId: user?.id ?? null,
      userEmail: user?.email ?? null,
      lat, lng, intent, limitPerSection,
    });
    return NextResponse.json(feed);
  } catch {
    return NextResponse.json({ error: "feed_unavailable" }, { status: 503 });
  }
}
