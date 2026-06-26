import { NextResponse } from "next/server";

const AKIBA_API = process.env.AKIBA_API_URL ?? "http://localhost:3001";

export const revalidate = 120;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const chain = searchParams.get("chain");

  try {
    const url = new URL(`${AKIBA_API}/api/v1/hub/rewards`);
    if (chain) url.searchParams.set("chain", chain);

    const res = await fetch(url.toString(), {
      headers: { "Content-Type": "application/json" },
      next: { revalidate: 120 },
    });

    if (!res.ok) throw new Error(`Upstream ${res.status}`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    // Return empty when Akiba API isn't running yet
    return NextResponse.json({ rewards: [] });
  }
}
