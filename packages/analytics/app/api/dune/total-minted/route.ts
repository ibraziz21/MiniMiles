import { NextRequest, NextResponse } from "next/server";
import { checkApiAuth } from "@/lib/auth";

const DUNE_API_BASE = "https://api.dune.com/api/v1";
const DEFAULT_QUERY_ID = "5668155";
const DEFAULT_COLUMN = "akiba_issued";

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export async function GET(request: NextRequest) {
  if (!checkApiAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const apiKey = process.env.DUNE_API_KEY;
    const queryId = process.env.DUNE_TOTAL_MINTED_QUERY_ID || DEFAULT_QUERY_ID;
    const column = process.env.DUNE_TOTAL_MINTED_COLUMN || DEFAULT_COLUMN;

    if (!apiKey) {
      return NextResponse.json(
        { error: "DUNE_API_KEY is not configured" },
        { status: 500 }
      );
    }

    const url = `${DUNE_API_BASE}/query/${queryId}/results?limit=1000&api_key=${encodeURIComponent(
      apiKey
    )}`;

    const upstream = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return NextResponse.json(
        { error: "Dune request failed", status: upstream.status, detail: text },
        { status: 502 }
      );
    }

    const json = await upstream.json();
    const rows = Array.isArray(json?.result?.rows) ? json.result.rows : [];
    const firstRow = rows[0] ?? null;
    const value =
      firstRow && typeof firstRow === "object"
        ? asNumber((firstRow as Record<string, unknown>)[column])
        : null;

    return NextResponse.json({
      queryId: Number(queryId),
      column,
      value,
      executionId: json?.execution_id ?? null,
      state: json?.state ?? null,
      submittedAt: json?.submitted_at ?? null,
      expiresAt: json?.expires_at ?? null,
      row: firstRow,
      metadata: json?.result?.metadata ?? null,
    });
  } catch (error: any) {
    console.error("[analytics/dune/total-minted]", error);
    return NextResponse.json(
      { error: error?.message ?? "Internal server error" },
      { status: 500 }
    );
  }
}
