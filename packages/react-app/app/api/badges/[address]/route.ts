// src/app/api/badges/[address]/route.ts
import { NextResponse } from "next/server";
import { getBadgeProgress } from "@/helpers/badgeStats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAddress(a: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(a);
}

export async function GET(_req: Request, context: any) {
  const params = context?.params;
  const address: string | undefined = params?.address;

  if (!address || !isAddress(address)) {
    return NextResponse.json(
      { ok: false, error: "Bad address", provided: address },
      { status: 400 }
    );
  }

  try {
    const data = await getBadgeProgress(address);

    return NextResponse.json({
      ok: true,
      ...data,
      meta: {
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (e: any) {
    console.error("[GET /api/badges/:address] error", e);
    return NextResponse.json(
      { ok: false, error: "server-error", detail: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
