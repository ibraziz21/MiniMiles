// app/api/user/[safe]/route.ts
import { NextResponse } from "next/server";

const PROSPERITY_URL =
  process.env.PROSPERITY_CORE_URL ??
  "https://prosperity-passport-backend-production.up.railway.app";

export async function GET(
  _req: Request,
  context: { params: Promise<{ safe: string }> }
) {
  const { safe } = await context.params;



  if (
    !safe ||
    typeof safe !== "string" ||
    !safe.startsWith("0x") ||
    safe.length !== 42
  ) {
    console.error("[Badges API] Invalid SAFE:", safe);
    return NextResponse.json(
      { error: "Invalid SAFE address" },
      { status: 400 }
    );
  }

  try {
    const url = `${PROSPERITY_URL}/api/user/${safe}/badges`;



    const res = await fetch(url, { cache: "no-store" });

    if (!res.ok) {
 
      return NextResponse.json({ currentBadges: [] }, { status: 200 });
    }

    const data = await res.json();



    return NextResponse.json(
      { currentBadges: data.currentBadges ?? [] },
      { status: 200 }
    );
  } catch (err) {
    console.error("[Badges API] ERROR fetching badges:", err);
    return NextResponse.json({ currentBadges: [] }, { status: 200 });
  }
}

// NEW: claim badges → POST /api/user/[safe]
export async function POST(
  _req: Request,
  context: { params: Promise<{ safe: string }> }
) {
  const { safe } = await context.params;

 

  if (
    !safe ||
    typeof safe !== "string" ||
    !safe.startsWith("0x") ||
    safe.length !== 42
  ) {
    console.error("[Badges API][CLAIM] Invalid SAFE:", safe);
    return NextResponse.json(
      { error: "Invalid SAFE address" },
      { status: 400 }
    );
  }

  try {
    const claimUrl = `${PROSPERITY_URL}/api/user/${safe}/badges/claim`;
  

    const upstream = await fetch(claimUrl, {
      method: "POST",
      headers: {
        accept: "application/json, text/plain, */*",
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });

    const text = await upstream.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }

    console.log(
      "[Badges API][CLAIM] Backend response:",
      json
    );

    return NextResponse.json(json, { status: upstream.status });
  } catch (err) {
    console.error("[Badges API][CLAIM] ERROR calling backend:", err);
    return NextResponse.json(
      { error: "Failed to claim badges" },
      { status: 500 }
    );
  }
}
